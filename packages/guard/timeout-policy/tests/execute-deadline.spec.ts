/**
 * W3 #24 `tool/execute-deadline` point-fix coverage. The timeout-policy wrapper
 * owns the deadline's arm/fire/restore transitions, which no public event
 * exposes; after each transition it appends a non-surface `tool/execute-deadline`
 * record to the call's Session. These tests assert the records land for a
 * budgeted call (armed + restored on a fast return; armed + fired + restored on
 * a deadline win) and that the wrapper's business result is unchanged — the
 * `TOOL_TIMEOUT` replacement still replaces the tool outcome, and an unconfigured
 * call writes nothing. The fired record carries the elapsed deadline from the
 * `timeoutOf` reason; armed/restored carry the declared budget.
 */
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { defineContentToolFixture, executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import SessionStore, { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecuteDeadlineEventData } from '@deepseek-ai/dsh-tool-call-timeout-policy/types'
import * as timeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy'

const DEADLINE = 'tool/execute-deadline'

/** Mount the registries the tool pipeline needs plus the timeout-policy enforcer. */
async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(SessionStore)
  await ctx.plugin(timeoutPolicy)
  return ctx
}

/** Minimal live-Agent shape for the tool pipeline: just the `session` the wrapper records against. */
function fakeAgent(session: Session): Agent {
  return { id: session.id, session } as unknown as Agent
}

/** The deadline-transition records appended for the session, in log order. */
function deadlineRecords(session: Session): ToolExecuteDeadlineEventData[] {
  return session.snapshotEvents()
    .filter((event): event is SessionEvent<typeof DEADLINE> => event.type === DEADLINE)
    .map(event => event.data)
}

/** A cooperative tool that settles only when its `exec.signal` aborts. */
const cooperativeTool = defineContentToolFixture({
  name: 'slow', description: 'stops when aborted', parameters: {}, timeoutMs: 100,
  execute(_args, exec): Promise<{ type: 'text'; text: string }[]> {
    const done = [{ type: 'text' as const, text: 'stopped cooperatively' }]
    if (exec.signal.aborted) return Promise.resolve(done)
    return new Promise(resolve => { exec.signal.addEventListener('abort', () => { resolve(done) }) })
  },
})

describe('timeout-policy tool/execute-deadline records', () => {
  it('appends armed + restored (no fired) for a budgeted tool that returns fast', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('fast'))
    ctx.tools.register(defineContentToolFixture({
      name: 'fast', description: 'd', parameters: {}, timeoutMs: 10_000,
      async execute() { return [{ type: 'text' as const, text: 'ok' }] },
    }))
    const result = await executeToolFixture(ctx, {
      callId: ToolCallId('c1'), name: 'fast', arguments: {}, signal: new AbortController().signal, agent: fakeAgent(session),
    })
    expect(result).toEqual({
      content: [{ type: 'text', text: 'ok' }], isError: false, value: [{ type: 'text', text: 'ok' }],
    })
    expect(deadlineRecords(session)).toMatchObject([
      { callId: ToolCallId('c1'), name: 'fast', sessionId: session.id, state: 'armed', timeoutMs: 10_000, signalReplaced: true },
      { callId: ToolCallId('c1'), name: 'fast', sessionId: session.id, state: 'restored', timeoutMs: 10_000, signalReplaced: true },
    ])
    await ctx.fiber.dispose()
  })

  it('appends armed + fired + restored when the deadline wins and keeps the TOOL_TIMEOUT result', async () => {
    vi.useFakeTimers()
    try {
      const ctx = await setup()
      const session = ctx.sessions.create(SessionId('slow'))
      ctx.tools.register(cooperativeTool)
      const pending = executeToolFixture(ctx, {
        callId: ToolCallId('c2'), name: 'slow', arguments: {}, signal: new AbortController().signal, agent: fakeAgent(session),
      })
      await vi.advanceTimersByTimeAsync(150)
      const result = await pending
      expect(result).toEqual({
        content: [{ type: 'text', text: 'Error: tool call timed out after 100ms' }],
        isError: true,
        error: { message: 'tool call timed out after 100ms', info: { name: 'ToolTimeoutError', code: 'TOOL_TIMEOUT' } },
      })
      // `armed` starts the clock and carries no elapsed time; `fired`/`restored`
      // report the real elapsed time and which signal ended the delegate.
      expect(deadlineRecords(session)).toMatchObject([
        { callId: ToolCallId('c2'), name: 'slow', sessionId: session.id, state: 'armed', timeoutMs: 100, signalReplaced: true },
        { callId: ToolCallId('c2'), name: 'slow', sessionId: session.id, state: 'fired', timeoutMs: 100, signalReplaced: true, abortSource: 'self-timer' },
        { callId: ToolCallId('c2'), name: 'slow', sessionId: session.id, state: 'restored', timeoutMs: 100, signalReplaced: true },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('writes no deadline record for an unconfigured tool or an agent-less dispatch', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('none'))
    ctx.tools.register(defineContentToolFixture({
      name: 'probe', description: 'd', parameters: {},
      async execute() { return [{ type: 'text' as const, text: 'ok' }] },
    }))
    // No budget: the wrapper delegates unchanged and appends nothing.
    await executeToolFixture(ctx, {
      callId: ToolCallId('u1'), name: 'probe', arguments: {}, signal: new AbortController().signal, agent: fakeAgent(session),
    })
    // Budgeted but agent-less: there is no Session to record against.
    ctx.tools.register(defineContentToolFixture({
      name: 'budgeted-no-agent', description: 'd', parameters: {}, timeoutMs: 10_000,
      async execute() { return [{ type: 'text' as const, text: 'ok' }] },
    }))
    await executeToolFixture(ctx, {
      callId: ToolCallId('u2'), name: 'budgeted-no-agent', arguments: {}, signal: new AbortController().signal,
    })
    expect(deadlineRecords(session)).toEqual([])
    await ctx.fiber.dispose()
  })
})
