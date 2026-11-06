/** SDK `session/cancel` stops one session and reports only after it settled. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { mountWorkingDirectoryFixture } from '../../../subagent/subagent/tests/working-directory-fixture.ts'
import { HarnessSdkJsonRpcServer } from '../src/server.ts'

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sdk-cancel-'))
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  // A turn that parks inside its step gives the test a real in-flight window;
  // nothing here fakes settlement, the agent must reach idle by itself.
  ctx.on('agent/pre-step', async (_payload, next) => {
    entered.resolve(undefined)
    await release.promise
    return next()
  })
  ctx.llm.registerAdapter(['mock'], new MockAdapter([textResponse('done')]))
  const server = new HarnessSdkJsonRpcServer(ctx, {
    request: () => Promise.reject(new Error('the server must not request the client')),
    notify: () => {},
  })
  await server.initialize({ cwd: root, provider: 'mock', model: 'mock' })
  return {
    ctx, server, entered, release,
    dispose: async () => {
      release.resolve(undefined)
      await server.shutdown()
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    },
  }
}

describe('SDK session/cancel', () => {
  it('reports only after the session reached idle, not when the request arrived', async () => {
    const { ctx, server, entered, release, dispose } = await setup()
    try {
      await server.prompt({ sessionId: 'main', contentBlocks: [{ type: 'text', text: 'work' }] })
      await entered.promise
      let settled = false
      const cancelling = server.handleRequest('session/cancel', { sessionId: 'main' })
        .then((result) => {
          settled = true
          return result
        })
      // The turn is parked inside its step, so cancellation cannot have
      // completed; a resolved request here would be a false success.
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(settled).toBe(false)
      release.resolve(undefined)
      await expect(cancelling).resolves.toEqual({ sessionId: 'main', cancelled: true })
      const agent = ctx.agents.get(SessionId('main'))!
      await agent.whenIdle()
    } finally {
      await dispose()
    }
  })

  it('leaves another session running', async () => {
    const { ctx, server, entered, release, dispose } = await setup()
    try {
      await server.prompt({ sessionId: 'first', contentBlocks: [{ type: 'text', text: 'work' }] })
      await entered.promise
      await server.prompt({ sessionId: 'second', contentBlocks: [{ type: 'text', text: 'work' }] })
      const cancelling = server.handleRequest('session/cancel', { sessionId: 'first' })
      release.resolve(undefined)
      await cancelling
      const second = ctx.agents.get(SessionId('second'))!
      expect(second).toBeDefined()
      expect(ctx.agents.get(SessionId('first'))).toBeDefined()
    } finally {
      await dispose()
    }
  })

  it('labels a blank session id as a protocol error', async () => {
    const { server, dispose } = await setup()
    try {
      await expect(server.handleRequest('session/cancel', { sessionId: '' }))
        .rejects.toThrow('session/cancel requires a non-empty sessionId')
      await expect(server.handleRequest('session/cancel', undefined))
        .rejects.toThrow('session/cancel requires a non-empty sessionId')
    } finally {
      await dispose()
    }
  })
})
