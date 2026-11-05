/** Durable, non-surface record of one timeout-policy deadline transition. @module @deepseek-ai/dsh-tool-call-timeout-policy */
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Durable, non-surface record of one `tools/execute` deadline transition owned by this policy:
     * `armed` when the per-tool deadline is swapped onto `exec.signal`, `fired` when this wrapper's
     * own timer won (the structured `TOOL_TIMEOUT` result replaces the tool's outcome), and `restored`
     * when the caller's upstream signal is back on `exec.signal` after dispatch settles. Written after
     * the business commit (the delegate result or the `TOOL_TIMEOUT` replacement); write failure only
     * warns and never changes the returned result or exception. `turn`/`step` are not carried because
     * the `tools/execute` payload has no step identity; the trajectory probe joins them from its
     * call-id → turn/step association index.
     * @param data.callId - the opaque call id shared across the tool waterfalls.
     * @param data.name - the tool name whose declared `timeoutMs` armed the deadline.
     * @param data.sessionId - the session that owns the call; present when `exec.agent` is set.
     * @param data.state - the transition recorded: `armed`, `fired`, or `restored`.
     * @param data.timeoutMs - the elapsed budget for `fired`, otherwise the declared deadline budget.
     */
    'tool/execute-deadline': ToolExecuteDeadlineEventData
  }
}

/** Payload for one `tool/execute-deadline` transition appended by the timeout-policy wrapper. */
export interface ToolExecuteDeadlineEventData {
  /** The opaque call id shared across `tools/pre-execute`|`execute`|`post-execute` for the same call. */
  readonly callId: ToolCallId
  /** The tool name whose declared `timeoutMs` armed the deadline. */
  readonly name: string
  /** The session owning the call; present when `exec.agent` is set, absent for an agent-less dispatch. */
  readonly sessionId?: SessionId
  /** The transition recorded: `armed` (deadline swapped on), `fired` (this timer won), or `restored` (upstream signal back). */
  readonly state: 'armed' | 'fired' | 'restored'
  /** The elapsed budget for `fired`, otherwise the declared deadline budget in milliseconds. */
  readonly timeoutMs: number
  /**
   * Milliseconds the delegate ran before this transition, measured from arming.
   * Present on `fired` and `restored`; absent on `armed`, which starts the clock.
   */
  readonly elapsedMs?: number
  /**
   * The abort reason the winning signal carried: this wrapper's own deadline
   * (`self-timer`) or an upstream caller's timer/abort (`upstream`). Present on
   * `fired` and `restored`; absent on `armed`.
   */
  readonly abortSource?: 'self-timer' | 'upstream'
  /** Whether this wrapper replaced the caller's signal for the delegate. Always true after arming. */
  readonly signalReplaced?: boolean
}
