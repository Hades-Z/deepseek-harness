/** Durable per-session state for the user-controlled model-selection opt-in. */

import { z as zod } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import { errorChain } from '@deepseek-ai/dsh-llm'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ProjectionHandle } from '@deepseek-ai/dsh-session-projection'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { assertAllowedModelRoutes, type AllowedModelRoute } from './model-selection.ts'
import type { DelegationModelRequest } from './model-selection.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Records this Session’s authorized child provider/model routes. Appended
     * before the first model request; absence restricts explicit selection
     * to the current parent route. Log-only: it carries
     * no `surfaceOp` and never enters model history.
     */
    'subagent/model-selection-policy': {
      /** Exact routes this Session may select explicitly for a child. */
      allowedModels: AllowedModelRoute[]
    }
    /**
     * Records the route selection one accepted delegation actually took, in the
     * delegating Session. Appended once the child is published, after the
     * policy assertion and any route preflight passed; a rejected call records
     * nothing. The policy event alone cannot show what one delegation selected,
     * because it predates every instance. Log-only: it carries no `surfaceOp`
     * and never enters model history.
     */
    'subagent/model-selection-observation': SubagentModelSelectionObservation
  }
}

/** Selection facts one accepted delegation recorded in the delegating Session. */
export interface SubagentModelSelectionObservation {
  /** The published child the observation belongs to. */
  subagentId: SessionId
  /**
   * The model-facing route fields the call supplied; absent when the call
   * selected nothing and inherited the configured or parent route.
   */
  requested?: DelegationModelRequest
  /**
   * Child agent options this tool forwarded to the provider; absent when it
   * forwarded none and the provider's own defaults resolve the route, which
   * this observation cannot see.
   */
  forwarded?: AgentOptions
  /** Whether a durable Session policy constrained this selection. */
  policyConstrained: boolean
}

const modelSelectionPolicySchema: zod.ZodType<AllowedModelRoute[] | null> = zod.array(zod.object({
  provider: zod.string().min(1),
  model: zod.string().min(1),
}).strict()).min(1).nullable()

/**
 * Host-only projection of the durable model-selection policy.
 * Each independently mounted consumer registers this shared definition; the registry reference-counts it.
 */
export const subagentModelSelectionProjectionDefinition = {
  key: 'subagentModelSelectionPolicy',
  stateVersion: 1,
  stateSchema: modelSelectionPolicySchema,
  init: () => null,
  apply: (policy, event) => {
    if (policy !== null || event.type !== 'subagent/model-selection-policy') return policy
    const { allowedModels } = event.data
    assertAllowedModelRoutes(allowedModels)
    if (allowedModels.length === 0) {
      throw new Error('subagent/model-selection-policy requires at least one route')
    }
    return allowedModels
  },
} satisfies ProjectionDefinition<'subagentModelSelectionPolicy', AllowedModelRoute[] | null>

/**
 * Read the exact route list authorized for a Session.
 * @param subagentModelSelectionProjectionHandle - registered policy state reader.
 * @param session - session whose durable decision is read.
 * @returns a detached route list, or undefined to restrict selection to the parent route.
 */
export function subagentModelSelectionPolicy(
  subagentModelSelectionProjectionHandle: Pick<ProjectionHandle<AllowedModelRoute[] | null>, 'stateOf'>,
  session: Session,
): AllowedModelRoute[] | undefined {
  return subagentModelSelectionProjectionHandle.stateOf(session)?.map(route => ({ ...route }))
}

/**
 * Record one accepted delegation's route selection in the delegating Session.
 * Append failure is contained: the warning names the child, and the delegation
 * keeps its accepted result unchanged.
 * @param logger - the plugin logger that contains append failures.
 * @param session - the delegating parent's durable session.
 * @param observation - selection facts taken after the child was published.
 */
export function recordModelSelectionObservation(
  logger: Context['logger'],
  session: Session,
  observation: SubagentModelSelectionObservation,
): void {
  try {
    session.append('subagent/model-selection-observation', observation)
  } catch (error: unknown) {
    logger.warn(
      `subagent "${observation.subagentId}": the route selection was not recorded as subagent/model-selection-observation: ${errorChain(error)}`,
    )
  }
}
