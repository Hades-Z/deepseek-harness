/** Model tool descriptions and complete batch execution owned by plugins. @module */
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { ToolCallBlock, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { PromptSection, ToolProviderResult } from '@deepseek-ai/dsh-system-prompt'
import type { ResolvedToolSet, ToolDefinition, ToolExecutionResult } from './contracts.ts'

/** Model-call schemas produced by an executor. */
export type ToolModelInput = Pick<ToolProviderResult, 'schemas' | 'knownNames'>

/** Executor-owned guidance registered through the system-prompt section API. */
export interface ToolPromptSection extends Pick<PromptSection, 'name' | 'order' | 'interpolate'> {
  /** Static guidance or text generated from this step's visible capability definitions. */
  readonly text: string | ((tools: readonly ToolDefinition[]) => string)
}

/** Ownership declared by the definition an executor actually invoked for one call. */
export interface ToolCallAttribution {
  /** Plugin id declared by the executed definition, if any. */
  readonly pluginOwner: string | null
  /** Provider id declared by the executed definition, if any. */
  readonly providerId: string | null
}

/**
 * Batch-local sink for the definition the shared pipeline actually invoked.
 * The tool registry supplies one per dispatch and turns what it receives into
 * `tool/result-attribution`, so the record names the definition that ran rather
 * than a later registration under the same name. Executors built on the shared
 * pipeline forward it; a custom executor that reports nothing leaves its calls
 * unattributed instead of being guessed from the current registry.
 */
export interface ToolBatchAttributionSink {
  /**
   * Record one executed call's declared ownership.
   * @param callId - the model call id being attributed.
   * @param attribution - ownership declared by the definition that ran.
   */
  record(callId: ToolCallId, attribution: ToolCallAttribution): void
}

/** Raw model calls, with optional Agent ownership and model-step logging. */
export interface ToolBatchInput {
  readonly calls: readonly ToolCallBlock[]
  readonly signal: AbortSignal
  /**
   * Positive integer overriding the executor's concurrency limit for this batch.
   * Applies to concurrency-safe root calls; program subcall limits remain separate.
   * Undefined uses the executor's configured limit.
   */
  readonly maxParallelToolCalls?: number
  /**
   * Owning Agent supplies scoped tools and execution context, including outside a turn.
   * Undefined for standalone calls outside an Agent, such as a service invocation.
   */
  readonly agent?: Agent
  /**
   * Step admission for every call in the batch, including program subcalls.
   * Undefined admits only unconditional registrations.
   */
  readonly toolSet?: ResolvedToolSet
  /**
   * Committed model step receiving root call/result events; requires `agent`.
   * Undefined when `agent` is absent or for calls outside a model response, such
   * as session initialization hooks. Without `log`, root call/result events are
   * omitted while `agent`, when provided, still supplies scope and execution context.
   */
  readonly log?: {
    readonly turn: number
    readonly step: number
  }
  /**
   * Registry-owned sink for the definitions actually invoked in this batch.
   * Supplied by `ToolsService.execute`; the shared pipeline reports each call's
   * executed ownership here. Never model-visible and not part of the settled
   * batch result.
   */
  readonly attribution?: ToolBatchAttributionSink
}

/** One settled result correlated with its original model call. */
export interface ToolCallResult {
  readonly callId: ToolCallId
  readonly result: ToolExecutionResult
}

/** Model-ordered outcomes and context accepted for the next step. */
export interface ToolBatchResult {
  readonly results: readonly ToolCallResult[]
  readonly additionalContexts: readonly UserMessage[]
  readonly concluded: boolean
}

/** A plugin owns argument parsing, dispatch, scheduling, cancellation, and logging. */
export interface ToolExecutor {
  /**
   * Stable executor identity recorded in `tool/result-attribution`. Declared by
   * executor packages that want their batches attributed by name; omitted
   * leaves the record partial. Constructor names are not used: they are
   * unstable across builds and do not identify the deployment's selection.
   */
  readonly executorId?: string
  /** Guidance registered and disposed with this executor; absent means no executor-owned sections. */
  readonly sections?: readonly ToolPromptSection[]
  /**
   * Describe the model's callable tools.
   * @param tools - currently visible capability definitions, after scoped restrictions.
   * @returns schemas and names used to validate tool ordering.
   */
  describe(tools: readonly ToolDefinition[]): ToolModelInput
  /**
   * Execute a complete batch. With log, commit root call/result events to the
   * Agent's Session; without log, omit those events. Tool-owned events may still
   * use the owning Agent's Session. Return
   * one outcome per input call in input order, including skipped calls on abort.
   * Never settle while started work is still running. Internal failures reject
   * with ToolBatchExecutionError after draining, preserving committed outcomes
   * and context; callers must stop dependent work and repair missing log results.
   * An explicit maxParallelToolCalls takes precedence over executor configuration.
   * @param input - original calls, cancellation, optional concurrency override, Agent and logging step.
   * @returns settled results, deferred context, and whether a success concludes the turn.
   */
  execute(input: ToolBatchInput): Promise<ToolBatchResult>
}

/** A drained batch failed internally; only the included results are committed. */
export class ToolBatchExecutionError extends Error {
  constructor(cause: unknown, readonly partial: ToolBatchResult) {
    super('Tool batch execution failed', { cause })
    this.name = 'ToolBatchExecutionError'
  }
}

/** The selected provider is missing or unloaded; another provider must not take its calls. */
export class ToolExecutorUnavailableError extends HarnessError {
  constructor() {
    super('The selected tool executor is unavailable. Load an executor in this composition before running the agent.', 'TOOL_EXECUTOR_UNAVAILABLE')
    this.name = 'ToolExecutorUnavailableError'
  }
}
