/**
 * Coverage for @deepseek-ai/dsh-tool-call-retry-policy: the opt-in budget, the
 * per-attempt `tool/retry-started` record, cancellation never retrying, and the
 * unchanged single-attempt path for tools that declare no budget.
 */

import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { HarnessError, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { TOOL_ABORTED, type ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import { defineContentToolFixture, executeModelToolFixture, executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as retryPolicy from '../src/index.ts'

const testSignal = new AbortController().signal

/** An owning agent backed by a real Session, so every appended record passes JSON validation. */
function sessionAgent(): NonNullable<ToolExecutionInput['agent']> {
  return { session: Session.create(SessionId('retry-policy')) } as unknown as NonNullable<ToolExecutionInput['agent']>
}

/** Mount the registry plus the retry wrapper. */
async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(retryPolicy)
  return ctx
}

/** A tool that fails `failures` times with a structured code, then succeeds. */
function flakyTool(
  name: string,
  failures: number,
  options: { attemptLimit?: number; backoffMs?: number } = {},
) {
  let calls = 0
  return defineContentToolFixture({
    name, description: 'fails then succeeds', parameters: {},
    ...options.attemptLimit === undefined
      ? {}
      : { retry: { maxAttempts: options.attemptLimit, ...options.backoffMs === undefined ? {} : { backoffMs: options.backoffMs } } },
    async execute() {
      calls += 1
      if (calls <= failures) throw new HarnessError('transient', 'TRANSIENT')
      return [{ type: 'text' as const, text: `ok after ${calls}` }]
    },
  })
}

/** Every `tool/retry-started` record on one session, in log order. */
function retryRecords(agent: NonNullable<ToolExecutionInput['agent']>) {
  return agent.session.snapshotEvents().filter((event) => event.type === 'tool/retry-started')
}

describe('retry-policy delegation (no declared budget)', () => {
  it('dispatches a tool with no retry declaration exactly once', async () => {
    const ctx = await setup()
    let calls = 0
    ctx.tools.register(defineContentToolFixture({
      name: 'once', description: 'd', parameters: {},
      async execute() { calls += 1; throw new HarnessError('boom', 'BOOM') },
    }))
    const result = await executeModelToolFixture(ctx, {
      callId: ToolCallId('c1'), name: 'once', arguments: {}, signal: testSignal,
    })
    expect(calls).toBe(1)
    expect(result.isError).toBe(true)
  })
})

describe('retry-policy budget', () => {
  it('retries until success and records each retry attempt', async () => {
    const ctx = await setup()
    const agent = sessionAgent()
    ctx.tools.register(flakyTool('flaky', 2, { attemptLimit: 3 }))
    const result = await executeModelToolFixture(ctx, {
      callId: ToolCallId('c1'), name: 'flaky', arguments: {}, signal: testSignal, agent,
    })
    expect(result.isError).toBe(false)
    const records = retryRecords(agent)
    expect(records).toHaveLength(2)
    const [first, second] = records
    if (first?.type !== 'tool/retry-started' || second?.type !== 'tool/retry-started') {
      throw new Error('unexpected record type')
    }
    expect([first.data.attempt, second.data.attempt]).toEqual([2, 3])
    expect([first.data.priorErrorCode, second.data.priorErrorCode]).toEqual([
      'TRANSIENT', 'TRANSIENT',
    ])
    expect(first.data.maxAttempts).toBe(3)
    expect(first.data.sessionId).toBe(agent.session.id)
  })

  it('stops at the declared attempt budget and returns the last failure', async () => {
    const ctx = await setup()
    const agent = sessionAgent()
    ctx.tools.register(flakyTool('always-fails', Number.POSITIVE_INFINITY, { attemptLimit: 3 }))
    const result = await executeModelToolFixture(ctx, {
      callId: ToolCallId('c1'), name: 'always-fails', arguments: {}, signal: testSignal, agent,
    })
    expect(result.isError).toBe(true)
    expect(retryRecords(agent)).toHaveLength(2)
  })

  it('a single-attempt budget never retries and records nothing', async () => {
    const ctx = await setup()
    const agent = sessionAgent()
    ctx.tools.register(flakyTool('one-shot', Number.POSITIVE_INFINITY, { attemptLimit: 1 }))
    const result = await executeModelToolFixture(ctx, {
      callId: ToolCallId('c1'), name: 'one-shot', arguments: {}, signal: testSignal, agent,
    })
    expect(result.isError).toBe(true)
    expect(retryRecords(agent)).toHaveLength(0)
  })

  it('does not retry a success', async () => {
    const ctx = await setup()
    const agent = sessionAgent()
    ctx.tools.register(flakyTool('healthy', 0, { attemptLimit: 5 }))
    const result = await executeModelToolFixture(ctx, {
      callId: ToolCallId('c1'), name: 'healthy', arguments: {}, signal: testSignal, agent,
    })
    expect(result.isError).toBe(false)
    expect(retryRecords(agent)).toHaveLength(0)
  })
})

describe('retry-policy cancellation', () => {
  it('never retries a call the caller cancelled', async () => {
    const ctx = await setup()
    const agent = sessionAgent()
    const entered = Promise.withResolvers<undefined>()
    ctx.tools.register(defineContentToolFixture({
      name: 'cancelled', description: 'd', parameters: {}, retry: { maxAttempts: 3 },
      execute(_args, exec) {
        entered.resolve(undefined)
        if (exec.signal.aborted) return Promise.reject(new HarnessError('tool aborted', TOOL_ABORTED))
        return new Promise((_resolve, reject) => {
          exec.signal.addEventListener(
            'abort',
            () => { reject(new HarnessError('tool aborted', TOOL_ABORTED)) },
            { once: true },
          )
        })
      },
    }))
    const upstream = new AbortController()
    const pending = executeToolFixture(ctx, {
      callId: ToolCallId('c1'), name: 'cancelled', arguments: {}, signal: upstream.signal, agent,
    })
    await entered.promise
    upstream.abort('user cancelled')
    const result = await pending
    expect(result.isError).toBe(true)
    expect(result.error?.info?.code).toBe(TOOL_ABORTED)
    expect(retryRecords(agent)).toHaveLength(0)
  })
})

describe('retry-policy definition validation', () => {
  it('rejects a non-positive attempt budget', async () => {
    const ctx = await setup()
    expect(() => ctx.tools.register(defineContentToolFixture({
      name: 'bad', description: 'd', parameters: {}, retry: { maxAttempts: 0 },
      async execute() { return [{ type: 'text' as const, text: 'x' }] },
    }))).toThrow(/retry\.maxAttempts/)
  })
})
