import type { LlmFailure } from '@deepseek-ai/dsh-llm/types'
import type { RetryId } from './brand.ts'

export type { RetryId }

/**
 * Facts beyond this plugin's own scheduling decision that a retry may carry:
 * the delay `trigger` is observed here, while `assemblyDigest` and
 * `compactionGeneration` arrive from the loop through the
 * `agent/request-error` payload. All three are optional so listeners without
 * the enriched loop keep reading existing payloads unchanged.
 */
export interface RetryLoopFacts {
  /**
   * Why the delay took its value: the provider's `retry-after` was honored
   * (`provider-retry-after`) or the local backoff policy computed it
   * (`policy-backoff`).
   */
  readonly trigger?: 'provider-retry-after' | 'policy-backoff'
  /** SHA-256 hex of the step's rendered system prompt, supplied by the loop. */
  readonly assemblyDigest?: string
  /** Session surface generation when the step assembled, supplied by the loop. */
  readonly compactionGeneration?: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Durable, non-surface record of one provider-routed retry scheduled after a failed request attempt. */
    'llm/retry': LlmRetryEventData
    /** Durable transition written after a retry wait succeeds and before the next request attempt starts. */
    'llm/retry-started': LlmRetryStartedEventData
  }
}

/** Durable payload recorded before one provider-routed model-request retry wait. */
export type LlmRetryEventData =
  | (RetryLoopFacts & {
    retryId: RetryId
    turn: number
    step: number
    provider: string
    mode: 'normal'
    policyKey: string
    retry: number
    maxRetries: number
    delayMs: number
    failure: LlmFailure
  })

  | (RetryLoopFacts & {
    retryId: RetryId
    turn: number
    step: number
    provider: string
    mode: 'always'
    policyKey: string
    retry: number
    delayMs: number
    failure: LlmFailure
  })

/** Durable transition recorded after one retry delay completes. */
export interface LlmRetryStartedEventData extends RetryLoopFacts {
  retryId: RetryId
  turn: number
  step: number
  retry: number
}
