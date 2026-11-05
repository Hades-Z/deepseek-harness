/**
 * The log-only `spill/spilled` observation: one Session record per successful
 * spill decision, with the configured threshold and the actual retention
 * accounting; no record when nothing is spilled; and a failed append that leaves
 * the replacement result unchanged.
 */
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { SpillLocator, SpillStore } from '@deepseek-ai/dsh-spill'
import type { SaveTextSpill, SpillRef } from '@deepseek-ai/dsh-spill'
import { defineContentToolFixture, executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import * as SpillPolicy from '@deepseek-ai/dsh-spill-policy'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

const signal = new AbortController().signal

/** A spill backend that records saves and returns a stable locator. */
class StubStore extends SpillStore {
  saves: SaveTextSpill[] = []

  async saveText(input: SaveTextSpill): Promise<SpillRef> {
    this.saves.push(input)
    return {
      locator: SpillLocator(`/spill/${input.suggestedName}`),
      bytes: Buffer.byteLength(input.content, 'utf8'),
      retrievalHint: 'Use the stub retrieval path.',
    }
  }
}

/** A tool returning `text` verbatim. */
function textTool(name: string, text: string) {
  return defineContentToolFixture({
    name,
    description: name,
    parameters: {},
    async execute(): Promise<ContentBlock[]> { return [{ type: 'text', text }] },
  })
}

/** Build tools + the policy + a spill backend for one spill decision. */
async function setup(maxInlineTokens: number): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SessionStore)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(StubStore)
  await ctx.plugin(SpillPolicy, { maxInlineTokens })
  onTestFinished(async () => { await ctx.fiber.dispose() })
  return ctx
}

/** The policy reads only the owning session; the real store supplies the log target. */
function agentFor(session: Session): never {
  return { id: session.id, session } as never
}

describe('spill/spilled record', () => {
  it('records the threshold and the real retention accounting once per spill', async () => {
    const ctx = await setup(64)
    const session = ctx.sessions.create(SessionId('spill-event'), { meta: { cwd: process.cwd() } })
    const events: SessionEvent[] = []
    ctx.on('session/event', (owner, event) => { if (owner === session) events.push(event) })
    const body = 'HEAD'.repeat(200) + 'TAIL'.repeat(200)
    ctx.tools.register(textTool('big', body))

    const result = await executeToolFixture(ctx, {
      signal,
      callId: ToolCallId('call-big'),
      name: 'big',
      arguments: {},
      agent: agentFor(session),
    })

    expect(result.isError).toBe(false)
    const spilled = events.filter(event => event.type === 'spill/spilled')
    expect(spilled).toHaveLength(1)
    const record = spilled[0]!
    // Log-only: a non-surface event carries no surface placement metadata.
    expect(record).not.toHaveProperty('surfaceOp')
    const notice = /Omitted (\d+) bytes/.exec(result.content
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.text).join(''))
    expect(notice).not.toBeNull()
    expect(record.data).toMatchObject({
      callId: 'call-big',
      toolName: 'big',
      label: 'result',
      threshold: 64,
      ref: { locator: '/spill/big.txt', bytes: Buffer.byteLength(body, 'utf8') },
      omittedBytes: Number(notice![1]),
      omittedImages: 0,
    })
    // The two digests differ: the model received a bounded preview, not the source.
    expect(record.data).toMatchObject({
      originalDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      previewDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  it('writes nothing when the result fits the budget', async () => {
    const ctx = await setup(1000)
    const session = ctx.sessions.create(SessionId('no-spill-event'), { meta: { cwd: process.cwd() } })
    const events: SessionEvent[] = []
    ctx.on('session/event', (owner, event) => { if (owner === session) events.push(event) })
    ctx.tools.register(textTool('small', 'tiny'))

    const result = await executeToolFixture(ctx, {
      signal,
      callId: ToolCallId('call-small'),
      name: 'small',
      arguments: {},
      agent: agentFor(session),
    })

    expect(result.isError).toBe(false)
    expect(events.filter(event => event.type === 'spill/spilled')).toHaveLength(0)
  })

  it('keeps the replacement result when the log append fails', async () => {
    const ctx = await setup(64)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const session = {
      header: { id: SessionId('append-fail') },
      append: (): never => { throw new Error('log closed') },
    }
    const body = 'HEAD'.repeat(200) + 'TAIL'.repeat(200)
    ctx.tools.register(textTool('big', body))

    const result = await executeToolFixture(ctx, {
      signal,
      callId: ToolCallId('call-append-fail'),
      name: 'big',
      arguments: {},
      agent: { id: SessionId('append-fail'), session } as never,
    })

    expect(result.isError).toBe(false)
    const text = result.content
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map(block => block.text).join('')
    expect(text).toContain('Full formatted result stored at: /spill/big.txt')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('spill/spilled'))
  })
})
