/** In-batch scheduling is recorded at start, reclassification, and commit. */
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { afterEach, expect, it } from 'vitest'
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
  const session = Session.create(SessionId('plan'))
  const agent = { id: session.id, session } as Agent
  ctx.tools.register(defineTool({
    name: 'echo',
    description: 'Echoes its text.',
    parameters: { mode: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) { return args.mode ?? '' },
    isConcurrencySafe: args => args.mode === 'safe',
  }))
  return { ctx, session, agent, signal: new AbortController().signal }
}

const call = (id: string, mode: string) => ({
  type: 'tool-call' as const, id: ToolCallId(id), name: 'echo', arguments: JSON.stringify({ mode }),
})

function planEvents(session: Session) {
  return session.snapshotEvents().filter(event => event.type === 'tool/execution-plan')
    .map(event => event.type === 'tool/execution-plan' ? event.data : undefined)
}

it('records start and commit phases for a parallel group', async () => {
  const h = await setup()

  await h.ctx.tools.execute({
    calls: [call('a', 'safe'), call('b', 'safe')],
    signal: h.signal, agent: h.agent, log: { turn: 1, step: 2 },
  })

  expect(planEvents(h.session)).toEqual([
    {
      sessionId: 'plan', turn: 1, step: 2, phase: 'start',
      calls: [{ callId: 'a', mode: 'parallel' }, { callId: 'b', mode: 'parallel' }],
      reclassified: null, exclusiveBarrier: null, consumed: null, concluded: null,
    },
    {
      sessionId: 'plan', turn: 1, step: 2, phase: 'commit',
      calls: [{ callId: 'a', mode: 'parallel' }, { callId: 'b', mode: 'parallel' }],
      reclassified: null, exclusiveBarrier: null, consumed: 2, concluded: false,
    },
  ])
})

it('records a reclassification before the exclusive call runs in its own group', async () => {
  const h = await setup()

  await h.ctx.tools.execute({
    calls: [call('a', 'safe'), call('b', 'unsafe')],
    signal: h.signal, agent: h.agent, log: { turn: 2, step: 3 },
  })

  const events = planEvents(h.session)
  expect(events.map(data => data?.phase)).toEqual(['start', 'reclassify', 'commit', 'start', 'commit'])
  expect(events[1]).toMatchObject({
    phase: 'reclassify',
    calls: [{ callId: 'a', mode: 'parallel' }, { callId: 'b', mode: 'exclusive' }],
    reclassified: { callId: 'b', mode: 'exclusive' },
    exclusiveBarrier: 'b',
    consumed: null,
    concluded: null,
  })
  expect(events[2]).toMatchObject({ phase: 'commit', consumed: 1, concluded: false })
  expect(events[3]).toMatchObject({ phase: 'start', calls: [{ callId: 'b', mode: 'exclusive' }] })
  expect(events[4]).toMatchObject({ phase: 'commit', consumed: 1, concluded: false })
})

it('records nothing when the batch commits outside a model step', async () => {
  const h = await setup()

  const batch = await h.ctx.tools.execute({
    calls: [call('a', 'safe')], signal: h.signal, agent: h.agent,
  })

  expect(batch.results.map(({ result }) => result.isError)).toEqual([false])
  expect(planEvents(h.session)).toEqual([])
})
