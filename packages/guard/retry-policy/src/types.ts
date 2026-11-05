/** Durable, non-surface record of one retried tool attempt. @module @deepseek-ai/dsh-tool-call-retry-policy */
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Durable, non-surface record of one retried tool attempt about to start,
     * appended by the retry-policy `tools/execute` wrapper immediately before
     * dispatching a non-first attempt, only when the call has an owning Agent.
     * Written before the attempt runs, so a hard interrupt still leaves every
     * started retry behind; a rejected append warns and never aborts the retry.
     * `turn`/`step` are not carried because the `tools/execute` payload has no
     * step identity; the trajectory probe joins them from its call-id index.
     * @param data.callId - the opaque call id shared across the tool waterfalls.
     * @param data.name - the tool name whose declared `retry` budget allowed this attempt.
     * @param data.sessionId - the session that owns the call; present when `exec.agent` is set.
     * @param data.attempt - the attempt about to start; `2` is the first retry, never `1`.
     * @param data.maxAttempts - the declared total attempt budget, including the original attempt.
     * @param data.backoffMs - the delay slept before this attempt; `0` when no delay was declared.
     * @param data.priorErrorCode - the structured code of the attempt this retry follows, or `null` when it had none.
     */
    'tool/retry-started': ToolRetryStartedEventData
  }
}

/** Payload for one `tool/retry-started` record appended by the retry-policy wrapper. */
export interface ToolRetryStartedEventData {
  /** The opaque call id shared across `tools/pre-execute`|`execute`|`post-execute` for the same call. */
  readonly callId: ToolCallId
  /** The tool name whose declared `retry` budget allowed this attempt. */
  readonly name: string
  /** The session owning the call; present when `exec.agent` is set, absent for an agent-less dispatch. */
  readonly sessionId?: SessionId
  /** The attempt about to start; `2` is the first retry, never `1`. */
  readonly attempt: number
  /** The declared total attempt budget, including the original attempt. */
  readonly maxAttempts: number
  /** The delay slept before this attempt started, in milliseconds; `0` when no delay was declared. */
  readonly backoffMs: number
  /** The structured error code of the attempt this retry follows, or `null` when it carried none. */
  readonly priorErrorCode: string | null
}
