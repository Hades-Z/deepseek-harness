/** Settled batches record explicit executor identity and per-call ownership. */
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

async function setup({ native = true } = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (native) await ctx.plugin(NativeToolExecutor)
  const session = Session.create(SessionId('attribution'))
  const agent = { id: session.id, session } as Agent
  return { ctx, session, agent, signal: new AbortController().signal }
}

function declaringTool(name: string, ownership: { pluginOwner?: string; providerId?: string } = {}) {
  return defineTool({
    name,
    description: `${name} tool.`,
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return name },
    ...ownership,
  })
}

const call = (id: string, name: string) => ({ type: 'tool-call' as const, id: ToolCallId(id), name, arguments: '{}' })

it('records the selected executor and each call\'s declared ownership after settlement', async () => {
  const h = await setup()
  h.ctx.tools.register(declaringTool('alpha', { pluginOwner: 'plugin-alpha', providerId: 'provider-alpha' }))
  h.ctx.tools.register(declaringTool('beta', { pluginOwner: 'plugin-beta' }))

  await h.ctx.tools.execute({
    calls: [call('first', 'alpha'), call('second', 'beta')],
    signal: h.signal, agent: h.agent, log: { turn: 3, step: 7 },
  })

  const events = h.session.snapshotEvents().filter(event => event.type === 'tool/result-attribution')
  expect(events).toHaveLength(1)
  expect(events[0]?.type === 'tool/result-attribution' && events[0].data).toEqual({
    sessionId: 'attribution',
    turn: 3,
    step: 7,
    executorId: 'native',
    calls: [
      { callId: 'first', pluginOwner: 'plugin-alpha', providerId: 'provider-alpha' },
      { callId: 'second', pluginOwner: 'plugin-beta', providerId: null },
    ],
  })
})

it('attributes a settled call to its original definition after replacement', async () => {
  const h = await setup()
  const original = declaringTool('alpha', { pluginOwner: 'original-owner' })
  let unregister = () => {}
  unregister = h.ctx.tools.register({
    ...original,
    async execute() {
      unregister()
      h.ctx.tools.register(declaringTool('alpha', { pluginOwner: 'replacement-owner' }))
      return 'alpha'
    },
  })

  const batch = await h.ctx.tools.execute({ calls: [call('first', 'alpha')], signal: h.signal, agent: h.agent })

  expect(batch.results[0]?.result).toMatchObject({ isError: false, value: 'alpha' })
  const event = h.session.snapshotEvents().find(item => item.type === 'tool/result-attribution')
  expect(event?.type === 'tool/result-attribution' && event.data.calls).toEqual([
    { callId: 'first', pluginOwner: 'original-owner', providerId: null },
  ])
})

it('leaves per-call ownership null when the definition declares none', async () => {
  const h = await setup()
  h.ctx.tools.register(declaringTool('plain'))

  await h.ctx.tools.execute({
    calls: [call('only', 'plain')],
    signal: h.signal, agent: h.agent, log: { turn: 1, step: 2 },
  })

  const event = h.session.snapshotEvents().find(event => event.type === 'tool/result-attribution')
  expect(event?.type === 'tool/result-attribution' && event.data).toEqual({
    sessionId: 'attribution',
    turn: 1,
    step: 2,
    executorId: 'native',
    calls: [{ callId: 'only', pluginOwner: null, providerId: null }],
  })
})

it('records a null executor identity when the selected executor declares none', async () => {
  const h = await setup({ native: false })
  h.ctx.tools.setExecutor({
    describe: () => ({ schemas: [], knownNames: [] }),
    execute: async () => ({ results: [], additionalContexts: [], concluded: false }),
  })

  await h.ctx.tools.execute({ calls: [], signal: h.signal, agent: h.agent, log: { turn: 1, step: 1 } })

  const event = h.session.snapshotEvents().find(event => event.type === 'tool/result-attribution')
  expect(event?.type === 'tool/result-attribution' && event.data).toEqual({
    sessionId: 'attribution',
    turn: 1,
    step: 1,
    executorId: null,
    calls: [],
  })
})

it('records attribution for a batch that rejects and rethrows the same error', async () => {
  const h = await setup({ native: false })
  const cause = new Error('executor exploded')
  h.ctx.tools.setExecutor({
    executorId: 'custom',
    describe: () => ({ schemas: [], knownNames: [] }),
    execute: async () => { throw cause },
  })

  await expect(h.ctx.tools.execute({
    calls: [call('doomed', 'plain')],
    signal: h.signal, agent: h.agent, log: { turn: 2, step: 4 },
  })).rejects.toBe(cause)

  const event = h.session.snapshotEvents().find(event => event.type === 'tool/result-attribution')
  expect(event?.type === 'tool/result-attribution' && event.data).toEqual({
    sessionId: 'attribution',
    turn: 2,
    step: 4,
    executorId: 'custom',
    calls: [{ callId: 'doomed', pluginOwner: null, providerId: null }],
  })
})

it('keeps the settled batch unchanged when the attribution append fails', async () => {
  const h = await setup()
  h.ctx.tools.register(declaringTool('plain'))
  vi.spyOn(h.session, 'append').mockImplementation(() => { throw new Error('session append unavailable') })

  const batch = await h.ctx.tools.execute({
    calls: [call('only', 'plain')],
    signal: h.signal, agent: h.agent,
  })

  expect(batch.results.map(({ result }) => result.isError)).toEqual([false])
})
