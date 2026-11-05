/** Stage-level content rewrites are recorded once per settled result. */
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

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
  const session = Session.create(SessionId('rewrite'))
  const agent = { id: session.id, session } as Agent
  return { ctx, session, agent, signal: new AbortController().signal }
}

const call = (name = 'rewriting') => ({ type: 'tool-call' as const, id: ToolCallId('only'), name, arguments: '{}' })

function rewritingTool(overrides: {
  projectContent?: NonNullable<ToolDefinition['projectContent']>
  finalizeContent?: NonNullable<ToolDefinition['finalizeContent']>
  pluginOwner?: string
} = {}) {
  return defineTool({
    name: 'rewriting',
    description: 'Rewrites its content.',
    ...(overrides.pluginOwner === undefined ? {} : { pluginOwner: overrides.pluginOwner }),
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return 'body' },
    ...overrides.projectContent !== undefined ? { projectContent: overrides.projectContent } : {},
    ...overrides.finalizeContent !== undefined ? { finalizeContent: overrides.finalizeContent } : {},
  })
}

it('records project and finalize stages in pipeline order with their content digests', async () => {
  const h = await setup()
  h.ctx.tools.register(rewritingTool({
    projectContent: () => [{ type: 'text', text: 'projected' }],
    finalizeContent: () => [{ type: 'text', text: 'finalized' }],
  }))

  const batch = await h.ctx.tools.execute({
    calls: [call()], signal: h.signal, agent: h.agent, log: { turn: 1, step: 2 },
  })

  expect(batch.results[0]?.result.content).toEqual([{ type: 'text', text: 'finalized' }])
  const events = h.session.snapshotEvents().filter(event => event.type === 'tool/result-rewrite')
  expect(events).toHaveLength(1)
  expect(events[0]?.type === 'tool/result-rewrite' && events[0].data).toEqual({
    sessionId: 'rewrite',
    turn: 1,
    step: 2,
    callId: 'only',
    stages: [
      {
        stage: 'project',
        beforeDigest: 'eabe5d0fe6b60af2e94ab34097a7fad53205c24113298904a434dec625ea3ba7',
        digest: 'a639b9a85411a5eede8d73183bfda5bf0a37e904f471aeb7799c51c3dd06a47f',
        replacedField: 'content',
        // `projectContent` belongs to the tool definition, so the owner is the tool.
        listenerId: 'rewriting',
      },
      {
        stage: 'finalize',
        beforeDigest: 'a639b9a85411a5eede8d73183bfda5bf0a37e904f471aeb7799c51c3dd06a47f',
        digest: '1d3761465b7b59acb060b1aa51493558a6048ccfe2a0a4977474f8e7bbb22341',
        replacedField: 'content',
        listenerId: 'rewriting',
      },
    ],
  })
})

it('preserves a projected result when computing its observation digest fails', async () => {
  const h = await setup()
  h.ctx.tools.register(rewritingTool({
    projectContent: () => {
      vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => { throw new Error('digest unavailable') })
      return [{ type: 'text', text: 'projected' }]
    },
  }))

  try {
    const batch = await h.ctx.tools.execute({ calls: [call()], signal: h.signal, agent: h.agent })
    expect(batch.results[0]?.result).toMatchObject({ isError: false, content: [{ type: 'text', text: 'projected' }] })
  } finally {
    vi.restoreAllMocks()
  }
})

it('preserves a finalized result when computing its observation digest fails', async () => {
  const h = await setup()
  h.ctx.tools.register(rewritingTool({
    finalizeContent: () => {
      vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => { throw new Error('digest unavailable') })
      return [{ type: 'text', text: 'finalized' }]
    },
  }))

  try {
    const batch = await h.ctx.tools.execute({ calls: [call()], signal: h.signal, agent: h.agent })
    expect(batch.results[0]?.result).toMatchObject({ isError: false, content: [{ type: 'text', text: 'finalized' }] })
  } finally {
    vi.restoreAllMocks()
  }
})

it('preserves a post-execute replacement when computing its observation digest fails', async () => {
  const h = await setup()
  h.ctx.tools.register(rewritingTool())
  h.ctx.on('tools/post-execute', async (_exec, _result, next) => {
    await next()
    vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => { throw new Error('digest unavailable') })
    return { kind: 'accept', content: [{ type: 'text', text: 'policy' }] }
  })

  try {
    const batch = await h.ctx.tools.execute({ calls: [call()], signal: h.signal, agent: h.agent })
    expect(batch.results[0]?.result).toMatchObject({ isError: false, content: [{ type: 'text', text: 'policy' }] })
  } finally {
    vi.restoreAllMocks()
  }
})

it('preserves a post-execute denial when computing its observation digest fails', async () => {
  const h = await setup()
  h.ctx.tools.register(rewritingTool())
  h.ctx.on('tools/post-execute', async (_exec, _result, next) => {
    await next()
    vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => { throw new Error('digest unavailable') })
    return { kind: 'block', feedback: [{ type: 'text', text: 'denied by policy' }] }
  })

  try {
    const batch = await h.ctx.tools.execute({ calls: [call()], signal: h.signal, agent: h.agent })
    expect(batch.results[0]?.result).toMatchObject({ isError: true, content: [{ type: 'text', text: 'denied by policy' }] })
  } finally {
    vi.restoreAllMocks()
  }
})

it('records a post-execute rewrite when the waterfall replaces the content', async () => {
  const h = await setup()
  h.ctx.tools.register(rewritingTool())
  h.ctx.on('tools/post-execute', async (_exec, _result, next) => {
    await next()
    return { kind: 'accept', content: [{ type: 'text', text: 'policy' }] }
  })

  const batch = await h.ctx.tools.execute({
    calls: [call()], signal: h.signal, agent: h.agent, log: { turn: 2, step: 3 },
  })

  expect(batch.results[0]?.result.content).toEqual([{ type: 'text', text: 'policy' }])
  const event = h.session.snapshotEvents().find(event => event.type === 'tool/result-rewrite')
  expect(event?.type === 'tool/result-rewrite' && event.data).toEqual({
    sessionId: 'rewrite',
    turn: 2,
    step: 3,
    callId: 'only',
    stages: [
      {
        stage: 'post-execute',
        beforeDigest: 'eabe5d0fe6b60af2e94ab34097a7fad53205c24113298904a434dec625ea3ba7',
        digest: '4d7d5f10fb0d497ba2f7d23415487190c874093e161249b6a70bd4c865690605',
        replacedField: 'content',
        listenerId: null,
      },
    ],
  })
})

it('records nothing when no stage rewrites the content', async () => {
  const h = await setup()
  h.ctx.tools.register(rewritingTool())

  const batch = await h.ctx.tools.execute({
    calls: [call()], signal: h.signal, agent: h.agent, log: { turn: 1, step: 1 },
  })

  expect(batch.results[0]?.result.content).toEqual([{ type: 'text', text: 'body' }])
  expect(h.session.snapshotEvents().some(event => event.type === 'tool/result-rewrite')).toBe(false)
})

it('keeps the settled result unchanged when the rewrite append fails', async () => {
  const h = await setup()
  h.ctx.tools.register(rewritingTool({ finalizeContent: () => [{ type: 'text', text: 'finalized' }] }))
  vi.spyOn(h.session, 'append').mockImplementation(() => { throw new Error('session append unavailable') })

  const batch = await h.ctx.tools.execute({ calls: [call()], signal: h.signal, agent: h.agent })

  expect(batch.results[0]?.result.content).toEqual([{ type: 'text', text: 'finalized' }])
})

it('attributes a captured projector to its original owner after the tool is replaced', async () => {
  const h = await setup()
  const original = rewritingTool({
    pluginOwner: 'original-owner',
    projectContent: () => [{ type: 'text', text: 'projected' }],
  })
  let unregister = () => {}
  unregister = h.ctx.tools.register({
    ...original,
    async execute() {
      unregister()
      h.ctx.tools.register(rewritingTool({ pluginOwner: 'replacement-owner' }))
      return 'body'
    },
  })

  const batch = await h.ctx.tools.execute({ calls: [call()], signal: h.signal, agent: h.agent })

  expect(batch.results[0]?.result.content).toEqual([{ type: 'text', text: 'projected' }])
  const event = h.session.snapshotEvents().find(item => item.type === 'tool/result-rewrite')
  expect(event?.type === 'tool/result-rewrite' && event.data.stages).toEqual([
    expect.objectContaining({ stage: 'project', listenerId: 'original-owner' }),
  ])
})

it('names the declared plugin owner rather than the tool when a definition declares one', async () => {
  const h = await setup()
  h.ctx.tools.register(rewritingTool({
    finalizeContent: () => [{ type: 'text', text: 'finalized' }],
    pluginOwner: 'plugin-owning-rewriter',
  }))

  await h.ctx.tools.execute({ calls: [call()], signal: h.signal, agent: h.agent, log: { turn: 1, step: 1 } })

  const event = h.session.snapshotEvents().find(event => event.type === 'tool/result-rewrite')
  expect(event?.type === 'tool/result-rewrite' && event.data.stages).toEqual([
    expect.objectContaining({ stage: 'finalize', listenerId: 'plugin-owning-rewriter' }),
  ])
})
