/** An ask that degrades for a missing approval seam records the pre-serviceAsk branch. */
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  ctx.tools.register(defineTool({
    name: 'guarded',
    description: 'Requires approval.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return 'ran' },
  }))
  const session = Session.create(SessionId('approval'))
  const agent = { id: session.id, session } as Agent
  return { ctx, session, agent, signal: new AbortController().signal }
}

const call = () => ({ type: 'tool-call' as const, id: ToolCallId('guarded-call'), name: 'guarded', arguments: '{}' })

it('records the no-service degrade with the asking policy\'s reason', async () => {
  const h = await setup()
  h.ctx.on('tools/pre-execute', async (_exec, next) => {
    await next()
    return { kind: 'ask', reason: 'needs approval' }
  })

  const batch = await h.ctx.tools.execute({
    calls: [call()], signal: h.signal, agent: h.agent, log: { turn: 2, step: 5 },
  })

  expect(batch.results[0]?.result.isError).toBe(true)
  expect(JSON.stringify(batch.results[0]?.result.content)).toContain('needs approval')
  const events = h.session.snapshotEvents().filter(event => event.type === 'approval/unavailable')
  expect(events).toHaveLength(1)
  expect(events[0]?.type === 'approval/unavailable' && events[0].data).toEqual({
    sessionId: 'approval',
    turn: 2,
    step: 5,
    callId: 'guarded-call',
    toolName: 'guarded',
    reason: 'no-approval-service',
    askReason: 'needs approval',
  })
})

it('leaves askReason null when the asking policy supplies no reason', async () => {
  const h = await setup()
  h.ctx.on('tools/pre-execute', async (_exec, next) => {
    await next()
    return { kind: 'ask' }
  })

  const batch = await h.ctx.tools.execute({
    calls: [call()], signal: h.signal, agent: h.agent, log: { turn: 1, step: 1 },
  })

  expect(JSON.stringify(batch.results[0]?.result.content)).toContain('requires approval (not yet supported)')
  const event = h.session.snapshotEvents().find(event => event.type === 'approval/unavailable')
  expect(event?.type === 'approval/unavailable' && event.data).toMatchObject({
    askReason: null,
    reason: 'no-approval-service',
  })
})

it('degrades an agent-less ask without attempting a Session record', async () => {
  const h = await setup()
  h.ctx.on('tools/pre-execute', async (_exec, next) => {
    await next()
    return { kind: 'ask', reason: 'needs approval' }
  })

  const batch = await h.ctx.tools.execute({ calls: [call()], signal: h.signal })

  // With no ApprovalService composed, the no-service degrade wins before the
  // agent check; the execution still carries no Session, so nothing is recorded.
  expect(batch.results[0]?.result.isError).toBe(true)
  expect(JSON.stringify(batch.results[0]?.result.content)).toContain('needs approval')
  expect(h.session.snapshotEvents().some(event => event.type === 'approval/unavailable')).toBe(false)
})

it('keeps the degraded deny result when the record append fails', async () => {
  const h = await setup()
  h.ctx.on('tools/pre-execute', async (_exec, next) => {
    await next()
    return { kind: 'ask' }
  })
  vi.spyOn(h.session, 'append').mockImplementation(() => { throw new Error('session append unavailable') })

  const batch = await h.ctx.tools.execute({ calls: [call()], signal: h.signal, agent: h.agent })

  expect(batch.results[0]?.result.isError).toBe(true)
  expect(JSON.stringify(batch.results[0]?.result.content)).toContain('requires approval')
})
