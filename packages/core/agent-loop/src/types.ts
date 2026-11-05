/**
 * Log-only agent-loop session events owned by `@deepseek-ai/dsh-agent-loop`.
 * Each records a fact the external trajectory probe cannot observe from
 * public waterfalls: the settled pre-step admission outcome with a rejecter's
 * volunteered reason (#9), and the loop's settled turn-stopping summary (#32).
 * Every member is non-surface: none is in the `SurfaceEventType` union, so
 * none carries `SurfaceOp` and `deriveMessages()` ignores it.
 *
 * Declaration-merged into `SessionEventMap` in this package's own vocabulary,
 * mirroring `dsh-llm-retry`'s `llm/retry` pattern. `gen-persistence-catalog`
 * auto-discovers the merge; no manual registry step. One fact producer per
 * recording point: the turn-stopping listeners own their own vote records and
 * the loop owns exactly one settled summary per stop boundary.
 * @module dsh-agent-loop/types
 */
import type { MessageId } from '@deepseek-ai/dsh-llm'

/**
 * Durable payload for `turn/pre-step` (#9): how one proposed step's admission
 * settled. Written by the loop only after the decision is final. The claim
 * happens before the `agent/pre-step` waterfall, so a reject or cancellation
 * after the claim lists the message ids the claim consumed and the turn then
 * dropped.
 */
export interface TurnPreStepEventData {
  turn: number
  step: number
  /**
   * `entered` — the waterfall admitted the step; `rejected-by-pre-step` — a
   * listener returned `reject` and the turn blocks; `cancelled-before-admission`
   * — the turn signal aborted between the claim and a settled decision.
   */
  disposition: 'entered' | 'rejected-by-pre-step' | 'cancelled-before-admission'
  /** The rejecting listener's volunteered `observation.reason`, when present. */
  rejectReason?: string
  /** Ids of the claimed messages a reject or cancellation dropped, in claim order. */
  rejectedUserMessageIds?: readonly MessageId[]
}

/**
 * Durable payload for `turn/stopping` (#32): one producer's report at a turn's
 * stop boundary. Built-in turn-stopping listeners record their own vote facts
 * under their own `source`; the loop records exactly one settled summary per
 * boundary, after the serial `agent/turn-stopping` dispatch, stating whether
 * the turn actually stopped or steering input carried it into another step.
 */
export interface TurnStoppingEventData {
  turn: number
  /**
   * The loop's summary carries the last executed step; listener votes omit it
   * because the `agent/turn-stopping` notification carries no step.
   */
  step?: number
  /** The producing plugin's own identity; never inferred from a stack or path. */
  source: string
  /**
   * The loop's settled outcome, or a listener's own vote. Present when the
   * producer knows it: the loop records `stop` when the turn closes at the
   * boundary or `continue` when queued steering carries it into another step;
   * a listener records its own vote the same way.
   */
  outcome?: 'stop' | 'continue'
  /**
   * Ids the loop queued when the turn continues, or the message id a listener
   * steered to continue it; absent on a plain stop.
   */
  steeringMessageIds?: readonly MessageId[]
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Settled pre-step admission outcome for one proposed step. Log-only: the
     * admission decision shapes which messages reach the model, and a
     * rejecter's reason is private to its listener. The turn's `turn/end`
     * `blocked` reason corresponds to the latest `rejected-by-pre-step`
     * record, which carries the dropped message ids and reject reason.
     * @param data - the disposition, reject reason, and dropped message ids.
     */
    'turn/pre-step': TurnPreStepEventData
    /**
     * One producer's report at a turn's stop boundary. Log-only: the serial
     * `agent/turn-stopping` notification carries no payload, and the settled
     * stop-or-continue outcome lives only in the loop.
     * @param data - the producer's source, and for the loop summary the
     *   settled outcome and any steering message ids that continued the turn.
     */
    'turn/stopping': TurnStoppingEventData
  }
}
