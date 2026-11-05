/**
 * Cooperative tool-call timeout enforcer. A tool declares `timeoutMs` and
 * promises to honor `exec.signal`; this wrapper arms that deadline and maps its
 * own expiry to `TOOL_TIMEOUT` without racing or abandoning the tool promise.
 * After each deadline transition (arm/fire/restore) the wrapper appends a
 * non-surface `tool/execute-deadline` record to the call's Session, so a
 * trajectory consumer can observe the timer ownership and signal swap that no
 * public event exposes; the append is contained and never changes the returned
 * result or exception.
 *
 * FIXME: settle the intended `@deepseek-ai/dsh-timeout-guard` rename before the
 * first tagged release — suggestion only, aligning the name with its `guard/`
 * home; decide at resolution time
 * ([regrouping Agent Note](../../../../.agents/notes/archived/architecture/2026-07-29-package-regrouping.md)).
 *
 * @module @deepseek-ai/dsh-tool-call-timeout-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { ToolDispatchExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { ToolExecuteDeadlineEventData } from './types.ts'

export type { ToolExecuteDeadlineEventData } from './types.ts'

/**
 * The code owned by this plugin, used BOTH as the internal {@link deadline}
 * classification code AND as the structured error `code` on the replacement
 * tool result. Scoping {@link timeoutOf} to it keeps a nested outer deadline
 * (another `tools/execute` wrapper's timer that fired first) from being misread
 * as this plugin's own timeout — it reads as an ordinary upstream cancel.
 */
export const TOOL_TIMEOUT = 'TOOL_TIMEOUT'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'timeout-policy'

/** The tool registry service this plugin wraps (`tools/execute`) and reads (`get`). */
export const inject = ['tools']

/**
 * The structured result substituted when this plugin's deadline wins. `content`
 * is the model-facing message; `error.code` is the same {@link TOOL_TIMEOUT}
 * this plugin owns, so a retry/sandbox plugin (and replay) can route on it.
 *
 * @param timeoutMs - the elapsed budget, rendered into the model-facing message.
 * @returns the `isError` {@link ToolExecutionResult} with a `TOOL_TIMEOUT` error.
 */
function toolTimeoutResult(timeoutMs: number): ToolExecutionResult {
  const message = `tool call timed out after ${timeoutMs}ms`
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    error: { message, info: { name: 'ToolTimeoutError', code: TOOL_TIMEOUT } },
  }
}

/**
 * Append one `tool/execute-deadline` transition after the business commit it records. The append is
 * contained: failure is logged and never changes the returned result or the propagated exception.
 * Nothing is written when the dispatch carries no agent (no Session to record against). The `timeoutMs`
 * for `fired` is the elapsed deadline from the {@link timeoutOf} reason; `armed`/`restored` carry the
 * declared budget.
 */
function appendDeadline(
  ctx: Context,
  exec: ToolDispatchExecution,
  state: ToolExecuteDeadlineEventData['state'],
  timeoutMs: number,
  timing: { elapsedMs?: number; abortSource?: 'self-timer' | 'upstream' } = {},
): void {
  const agent = exec.agent
  if (agent === undefined) return
  try {
    agent.session.append('tool/execute-deadline', {
      callId: exec.callId,
      name: exec.name,
      sessionId: agent.session.id,
      state,
      timeoutMs,
      signalReplaced: true,
      ...timing.elapsedMs === undefined ? {} : { elapsedMs: timing.elapsedMs },
      ...timing.abortSource === undefined ? {} : { abortSource: timing.abortSource },
    })
  } catch (error) {
    // The wrapper owns the call's result; a failed observation must not change it.
    ctx.logger.warn('timeout-policy: failed to record tool/execute-deadline: %o', error)
  }
}

/**
 * Register the timeout wrapper. It resolves the caller-visible tool definition,
 * temporarily replaces `exec.signal`, delegates, restores the upstream signal,
 * and replaces the result only when this wrapper's own timer fired.
 */
export function apply(ctx: Context): void {
  ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    const timeoutMs = ctx.tools.get(exec.name, exec.agent)?.timeoutMs
    // A tool that declares no budget: no deadline, delegate unchanged.
    if (timeoutMs === undefined) return next()

    using d = deadline(exec.signal, timeoutMs, TOOL_TIMEOUT)
    // Swap the derived deadline onto exec for dispatch, then restore the
    // caller's own signal so post-execute listeners never see this plugin's
    // (possibly already-aborted) timeout signal.
    const upstream = exec.signal
    exec.signal = d.signal
    const armedAt = performance.now()
    appendDeadline(ctx, exec, 'armed', timeoutMs)
    try {
      const result = await next()
      // If OUR timer fired (scoped by code — a nested outer deadline reads as
      // undefined here), the tool/capability saw the abort and reached
      // quiescence; replace whatever it returned (its own abort result) with the
      // structured TOOL_TIMEOUT the model sees.
      const fired = timeoutOf(d.signal, TOOL_TIMEOUT)
      if (fired !== undefined) {
        appendDeadline(ctx, exec, 'fired', fired.timeoutMs, {
          elapsedMs: Math.round(performance.now() - armedAt),
          abortSource: 'self-timer',
        })
        return toolTimeoutResult(timeoutMs)
      }
      return result
    } finally {
      exec.signal = upstream
      const elapsedMs = Math.round(performance.now() - armedAt)
      // Our own timer already recorded `fired`; any other abort is an upstream one.
      const abortSource = timeoutOf(d.signal, TOOL_TIMEOUT) === undefined && d.signal.aborted
        ? { abortSource: 'upstream' as const }
        : {}
      appendDeadline(ctx, exec, 'restored', timeoutMs, { elapsedMs, ...abortSource })
    }
  })
}
