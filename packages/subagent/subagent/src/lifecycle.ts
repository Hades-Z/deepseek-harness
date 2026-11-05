/**
 * Lifecycle-edge publication for managed subagent activations.
 *
 * Public event payloads live in `./types.ts`; the package-private observer
 * retains only the identity shared by each start/end pair.
 *
 * @module @deepseek-ai/dsh-subagent/lifecycle
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { foldConsumedWork } from '@deepseek-ai/dsh-agent'
import { errorChain } from '@deepseek-ai/dsh-llm'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { SubagentRunId } from './types.ts'
import type { SubagentDelivery } from './control-types.ts'
import type { SubagentResult, SubagentRunEndInfo, SubagentRunInfo } from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records one residency epoch's terminal outcome in the delegating parent's
     * session, after the epoch's disposal outcome is known and the in-memory
     * `subagent/end` edge is published. Local runs list every delivery the
     * epoch admitted; external runs omit the list because their provider does
     * not expose accepted input. Log-only: it carries no `surfaceOp` and never
     * enters model history. Absence is not evidence of a run: an epoch that
     * failed before residency published no edge and no record.
     */
    'subagent/run-end': {
      /** Unique identity pairing this record with the epoch's lifecycle edges. */
      runId: SubagentRunId
      /** Provider name recorded when the child was first created. */
      provider: string
      /** The child's durable session id; external executions mint their own. */
      id: SessionId
      /** Whether the epoch owned a local Agent. */
      local: boolean
      /** The terminal stop reason derived from the run's own outcome. */
      stopReason: SubagentResult['stopReason']
      /**
       * Every delivery this local epoch admitted, in acceptance order.
       * Omitted for external runs, whose accepted input is unobservable here.
       */
      steers?: readonly { delivery: SubagentDelivery; messageId: MessageId }[]
    }
  }
}

/**
 * Lifecycle observer for one activation's residency epoch. Package-private: the
 * continuation manager is the only consumer, and its call ordering is an
 * in-package contract rather than a published extension point.
 */
export interface ActivationObserver {
  /**
   * Publish the start edge once the epoch is resident.
   * @param child - the resident local Agent, or undefined for an external execution.
   */
  start(child?: Agent): void
  /**
   * Record one delivery the resident epoch admitted, so {@link settle} lists it
   * in the durable run-end fact. External epochs never accept manager
   * deliveries, so they accumulate none.
   * @param delivery - inbox destination the accepted delivery took.
   * @param messageId - durable id of the accepted message.
   */
  recordSteer(delivery: SubagentDelivery, messageId: MessageId): void
  /**
   * Publish the terminal edge exactly once, pairing this epoch's {@link start},
   * after the disposal outcome is known, and append the durable
   * `subagent/run-end` fact to the delegating parent's session. Called only for
   * a resident epoch: a failure before residency publishes no edge, because
   * inventing one would report a lifecycle the child never had.
   * @param result - the captured result, with teardown failures applied.
   */
  settle(result: SubagentResult): void
}

/**
 * Publish one lifecycle edge with per-listener exception containment. Run edges
 * carry the delegating parent that keys scoped dispatch; provider removal has no
 * parent carrier and reaches listeners unscoped.
 *
 * The service owns this closure because scoped dispatch keys its carrier by the
 * exact service instance, whose own context filter composes into the carrier;
 * a narrowed stand-in would silently change scope filtering.
 */
export type LifecycleEmitter = {
  (name: 'subagent/start', info: SubagentRunInfo, parent: Agent): void
  (name: 'subagent/end', info: SubagentRunEndInfo, parent: Agent): void
  (name: 'subagent/provider-removed', info: string): void
}

/**
 * Build the contained lifecycle emitter this seam publishes every edge through.
 * Every listener is independently contained: a synchronous throw or a rejected
 * returned promise is logged without starving peer listeners, changing the run,
 * or — for provider removal, which fires from a disposer — breaking teardown.
 * @param ctx - the service's own context, owning dispatch and the logger.
 * @param carrier - resolve the scoped dispatch carrier for one delegating parent.
 * @returns the emitter both observers and the provider registry publish through.
 */
export function createLifecycleEmitter(
  ctx: Context,
  carrier: (parent: Agent) => object,
): LifecycleEmitter {
  return (
    name: 'subagent/start' | 'subagent/end' | 'subagent/provider-removed',
    info: SubagentRunInfo | SubagentRunEndInfo | string,
    parent?: Agent,
  ): void => {
    const dispatchArgs: unknown[] = parent === undefined
      ? [name, info]
      : [carrier(parent), name, info]
    for (const callback of ctx.events.dispatch('emit', dispatchArgs)) {
      try {
        const returned: unknown = callback(info)
        void Promise.resolve(returned).catch((error: unknown) => {
          ctx.logger.warn(`subagent: ${name} listener rejected: ${renderThrown(error)}`)
        })
      } catch (error: unknown) {
        ctx.logger.warn(`subagent: ${name} listener threw: ${renderThrown(error)}`)
      }
    }
  }
}

/**
 * Build the observer for one local or external activation's residency epoch. Creation failure before residency emits no lifecycle edge.
 * @param emit - the contained lifecycle emitter.
 * @param logger - the service logger that contains run-end append failures.
 * @param provider - the provider name recorded in the durable descriptor.
 * @param childId - the durable child session id.
 * @param parent - the exact live direct parent keying scoped dispatch; its session receives the run-end fact.
 * @returns the observer whose edges this epoch publishes.
 */
export function createActivationObserver(
  emit: LifecycleEmitter,
  logger: Context['logger'],
  provider: string,
  childId: SessionId,
  parent: Agent,
): ActivationObserver {
  const identity = { runId: SubagentRunId(randomUUID()), provider, id: childId, local: false }
  /** Deliveries this epoch admitted, in acceptance order; external epochs accumulate none. */
  const steers: { delivery: SubagentDelivery; messageId: MessageId }[] = []
  /** Whether this epoch reached residency; an unstarted epoch publishes no lifecycle edge. */
  let started = false
  return {
    recordSteer: (delivery, messageId): void => {
      steers.push({ delivery, messageId })
    },
    start: (child?: Agent): void => {
      started = true
      identity.local = child !== undefined
      emit('subagent/start', identity, parent)
    },
    settle: ({ stopReason, output }: SubagentResult): void => {
      // Creation failure before residency (for example a failed catalog append)
      // ends an epoch that never started; it owns neither an end edge nor a
      // durable run-end fact.
      if (!started) return
      emit('subagent/end', {
        ...identity,
        stopReason,
        ...output.length === 0 ? {} : { lastAssistantMessage: output },
      }, parent)
      try {
        parent.session.append('subagent/run-end', {
          ...identity,
          stopReason,
          // A local epoch always lists its deliveries, even zero of them; an
          // external epoch never accepts manager deliveries, so its list is
          // unobservable and stays omitted.
          ...identity.local ? { steers: [...steers] } : {},
        })
      } catch (error: unknown) {
        logger.warn(`subagent "${childId}": the run outcome was not recorded as subagent/run-end: ${errorChain(error)}`)
      }
    },
  }
}

/**
 * Why this child's epoch ended, for the terminal lifecycle edge and the
 * manager's own parent delivery. The child's own log is authoritative:
 * teardown succeeding says nothing about whether the model errored, hit its
 * token ceiling, or was cancelled, so deriving the reason from disposal would
 * report failed work as completed.
 *
 * {@link foldConsumedWork} supplies both halves the raw turn sequence cannot:
 * which turn accounts for the work this epoch consumed, and whether accepted
 * work was cancelled after it without any turn opening over it. A recorded
 * failure still wins over a cancellation — stopping a child that had already
 * failed does not turn its failure into a cancellation.
 * @param events - this epoch's own event suffix.
 * @returns its terminal stop reason; `completed` only for an epoch that both
 *   closed cleanly and had nothing left to run.
 */
export function epochStopReason(events: readonly SessionEvent[]): SubagentResult['stopReason'] {
  const { end, droppedUnrun } = foldConsumedWork(events)
  switch (end?.data.reason.kind) {
    case 'max-tokens':
      return 'max-tokens'
    case 'aborted':
    case 'interrupted':
      return 'aborted'
    case 'error':
      return 'error'
    // A pre-step rejection — a hook deny, a policy plugin — discarded input
    // this epoch had claimed: the work was declined, not done.
    case 'blocked':
      return 'refusal'
    // A clean ending and no accounting turn at all share one rule: the epoch
    // finished what it was given unless a cancelled queue says otherwise.
    case undefined:
    case 'completed':
      return droppedUnrun ? 'aborted' : 'completed'
    /* v8 ignore next 4 -- `forked` appears only in constructor seed history, while
     * this function reads an epoch-owned suffix. `TurnEndReason` is merge-extensible,
     * so a backend-added variant cannot be listed; treating an unnameable reason as
     * success would report failed work as completed. */
    default:
      return 'error'
  }
}

/** Render any listener-thrown value without letting coercion escape containment. */
function renderThrown(value: unknown): string {
  try {
    return value instanceof Error ? `${value.name}: ${value.message}` : String(value)
  } catch {
    return '<unrenderable thrown value>'
  }
}
