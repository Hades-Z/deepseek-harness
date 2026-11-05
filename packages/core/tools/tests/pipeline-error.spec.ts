/** Internal stage-boundary failures are recorded without changing the result. */
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'
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
  const session = Session.create(SessionId('pipeline-error'))
  const agent = { id: session.id, session } as Agent
  return { ctx, session, agent, signal: new AbortController().signal }
}

const call = () => ({ type: 'tool-call' as const, id: ToolCallId('only'), name: 'failing', arguments: '{}' })

function failingTool(overrides: {
  projectContent?: NonNullable<ToolDefinition['projectContent']>
  finalizeContent?: NonNullable<ToolDefinition['finalizeContent']>
}) {
  return defineTool({
    name: 'failing',
    description: 'Fails inside an internal stage.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return 'body' },
    ...overrides.projectContent !== undefined ? { projectContent: overrides.projectContent } : {},
    ...overrides.finalizeContent !== undefined ? { finalizeContent: overrides.finalizeContent } : {},
  })
}

it('records a project-stage failure before converting it to an error result', async () => {
  const h = await setup()
  h.ctx.tools.register(failingTool({ projectContent: () => { throw new Error('projector exploded') } }))

  const batch = await h.ctx.tools.execute({
    calls: [call()], signal: h.signal, agent: h.agent, log: { turn: 1, step: 2 },
  })

  expect(batch.results[0]?.result.isError).toBe(true)
  const events = h.session.snapshotEvents().filter(event => event.type === 'tool/pipeline-error')
  expect(events).toHaveLength(1)
  expect(events[0]?.type === 'tool/pipeline-error' && events[0].data).toEqual({
    sessionId: 'pipeline-error',
    turn: 1,
    step: 2,
    callId: 'only',
    stage: 'project',
    message: 'projector exploded',
    error: null,
    // The project callback is definition-owned: the throwing component is the tool.
    thrower: 'failing',
  })
})

it('records a finalize-stage failure with its structured HarnessError identity', async () => {
  const h = await setup()
  class FinalizeBoom extends HarnessError {
    constructor() { super('finalizer exploded', 'FINALIZER_FAILED') }
  }
  h.ctx.tools.register(failingTool({ finalizeContent: () => { throw new FinalizeBoom() } }))

  const batch = await h.ctx.tools.execute({
    calls: [call()], signal: h.signal, agent: h.agent, log: { turn: 3, step: 4 },
  })

  expect(batch.results[0]?.result.isError).toBe(true)
  const event = h.session.snapshotEvents().find(event => event.type === 'tool/pipeline-error')
  expect(event?.type === 'tool/pipeline-error' && event.data).toEqual({
    sessionId: 'pipeline-error',
    turn: 3,
    step: 4,
    callId: 'only',
    stage: 'finalize',
    message: 'finalizer exploded',
    error: { name: 'FinalizeBoom', code: 'FINALIZER_FAILED' },
    thrower: 'failing',
  })
})

it('keeps the converted error result unchanged when the failure append fails', async () => {
  const h = await setup()
  h.ctx.tools.register(failingTool({ finalizeContent: () => { throw new Error('finalizer exploded') } }))
  vi.spyOn(h.session, 'append').mockImplementation(() => { throw new Error('session append unavailable') })

  const batch = await h.ctx.tools.execute({ calls: [call()], signal: h.signal, agent: h.agent })

  expect(batch.results[0]?.result.isError).toBe(true)
  expect(JSON.stringify(batch.results[0]?.result.content)).toContain('finalizer exploded')
})

it('records a pre-execute waterfall failure at that boundary', async () => {
  const h = await setup()
  h.ctx.tools.register(failingTool({}))
  h.ctx.on('tools/pre-execute', () => { throw new Error('pre-execute listener exploded') })

  const batch = await h.ctx.tools.execute({
    calls: [call()], signal: h.signal, agent: h.agent, log: { turn: 4, step: 5 },
  })

  expect(batch.results[0]?.result.isError).toBe(true)
  const events = h.session.snapshotEvents().filter(event => event.type === 'tool/pipeline-error')
  expect(events).toHaveLength(1)
  expect(events[0]?.type === 'tool/pipeline-error' && events[0].data).toMatchObject({
    callId: 'only', stage: 'pre-execute', message: 'pre-execute listener exploded', thrower: null,
  })
})

it('records an execute-wrapper failure at that boundary', async () => {
  const h = await setup()
  h.ctx.tools.register(failingTool({}))
  h.ctx.on('tools/execute', () => { throw new Error('execute wrapper exploded') })

  const batch = await h.ctx.tools.execute({
    calls: [call()], signal: h.signal, agent: h.agent, log: { turn: 6, step: 7 },
  })

  expect(batch.results[0]?.result.isError).toBe(true)
  const event = h.session.snapshotEvents().find(event => event.type === 'tool/pipeline-error')
  expect(event?.type === 'tool/pipeline-error' && event.data).toMatchObject({
    callId: 'only', stage: 'execute-wrapper', message: 'execute wrapper exploded', thrower: null,
  })
})

it('records a post-execute waterfall failure at that boundary', async () => {
  const h = await setup()
  h.ctx.tools.register(failingTool({}))
  h.ctx.on('tools/post-execute', () => { throw new Error('post-execute listener exploded') })

  const batch = await h.ctx.tools.execute({
    calls: [call()], signal: h.signal, agent: h.agent, log: { turn: 8, step: 9 },
  })

  expect(batch.results[0]?.result.isError).toBe(true)
  const events = h.session.snapshotEvents().filter(event => event.type === 'tool/pipeline-error')
  expect(events).toHaveLength(1)
  expect(events[0]?.type === 'tool/pipeline-error' && events[0].data).toMatchObject({
    callId: 'only', stage: 'post-execute', message: 'post-execute listener exploded', thrower: null,
  })
})

it('does not attribute a post-execute materialization failure to the tool finalizer', async () => {
  const h = await setup()
  h.ctx.tools.register(failingTool({}))
  h.ctx.on('tools/post-execute', async (_exec, _result, next) => {
    await next()
    return { kind: 'accept', content: [{ type: 'text', get text(): string { throw new Error('invalid content') } }] }
  })

  const batch = await h.ctx.tools.execute({ calls: [call()], signal: h.signal, agent: h.agent })

  expect(batch.results[0]?.result.isError).toBe(true)
  const event = h.session.snapshotEvents().find(item => item.type === 'tool/pipeline-error')
  expect(event?.type === 'tool/pipeline-error' && event.data.thrower).toBeNull()
})

it('records a project failure exactly once when the outer boundary also catches it', async () => {
  const h = await setup()
  h.ctx.tools.register(failingTool({ projectContent: () => { throw new Error('projector exploded') } }))

  await h.ctx.tools.execute({ calls: [call()], signal: h.signal, agent: h.agent, log: { turn: 1, step: 1 } })

  const events = h.session.snapshotEvents().filter(event => event.type === 'tool/pipeline-error')
  expect(events).toHaveLength(1)
  expect(events[0]?.type === 'tool/pipeline-error' && events[0].data).toMatchObject({ stage: 'project' })
})
