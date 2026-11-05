/** Shared tool invocation policy, cancellation, and result settlement. @module */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEventMap, UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-approval'
import { assertNever, deepFreeze, snapshotJsonValue, type JsonValue } from '@deepseek-ai/dsh-util-values'
import { TOOL_ABORTED, TOOL_ABORTED_BEFORE_DISPATCH, ToolNotFoundError, ToolOutputError } from './contracts.ts'
import { validateJsonSchemaValue } from './json-schema.ts'
import type { ToolsService } from './index.ts'
import type { ResolvedToolSet, ToolDefinition, ToolExecutionInput, ToolExecutionMode, ToolExecution, ToolRunContext, ToolExecutionResult, ToolExecutionSuccess, ToolErrorInfo, ToolExecutionToken, PreToolDecision, PostToolDecision } from './contracts.ts'
import { appendToolLogEvent, type ToolLogEventKey } from './log-events.ts'
import type { ToolPipelineErrorEventData, ToolResultRewriteStage } from './types.ts'

/** Executor-owned lookup and restrictions applied before extensible execution policy. */
export interface ToolExecutionSource {
  /**
   * Override registry lookup for executor-owned capabilities; omitted uses the
   * retained registry's executable lookup, which applies the call's step admission.
   */
  get?(name: string, scope?: ScopeKey, toolSet?: ResolvedToolSet): ToolDefinition | undefined
  /** Reject an otherwise visible invocation before policy; omitted permits it. */
  reject?(name: string, nested: boolean): Error | undefined
}

/** Prepared invocation; immediate results carry their post-execute requirement. */
export type ScheduledToolPreparation =
  | { kind: 'dispatch'; exec: ToolRunContext }
  | ({ exec: ToolRunContext } & ScheduledToolDispatch)

/** A `post-result` receives post-execute; a `final-result` bypasses it. */
export type ScheduledToolDispatch =
  | { kind: 'post-result'; result: ToolExecutionResult }
  | { kind: 'final-result'; result: ToolExecutionResult }

/** Registry-owned live execution object; public pipeline views stay readonly. */
type MutableToolRunContext = Omit<ToolRunContext, 'signal'> & { signal: AbortSignal }

/** Approval decision plus whether the approval channel reported cancellation. */
interface ToolAskResolution {
  readonly decision: Extract<PreToolDecision, { kind: 'allow' | 'deny' }>
  readonly approvalCancelled: boolean
}

/** Caller cancellation and dispatch state kept outside the around-wrapper view. */
interface ToolCancellationState {
  readonly callerSignal: AbortSignal
  bodyInvoked: boolean
}

/** One dispatch-scoped fused signal plus listener cleanup after the body settles. */
interface FusedToolSignal {
  readonly signal: AbortSignal
  dispose(): void
}

/**
 * Shared invocation stages for batch and program schedulers. Schedulers order
 * prepare and complete calls while dispatch may overlap. Use executeToolBatch
 * for complete calls, including a single-call batch.
 */
export class ToolExecutionPipeline {
  private readonly tools: ToolsService

  constructor(private readonly ctx: Context, private readonly source: ToolExecutionSource = {}) {
    // Accepted calls retain their event subject while the service is withdrawn during shutdown.
    this.tools = ctx.tools
  }

  private get(name: string, scope: ScopeKey | undefined, toolSet: ResolvedToolSet | undefined): ToolDefinition | undefined {
    return this.source.get === undefined
      ? this.tools.executable(name, scope, toolSet)
      : this.source.get(name, scope, toolSet)
  }

  private resolveExecution(
    name: string, scope: ScopeKey | undefined, nested: boolean, toolSet: ResolvedToolSet | undefined,
  ): ToolDefinition | undefined {
    const tool = this.get(name, scope, toolSet)
    return tool !== undefined && this.source.reject?.(name, nested) === undefined ? tool : undefined
  }

  /** Context deferred by a running tool body, keyed by its scheduler-owned execution. */
  private deferredContexts = new WeakMap<ToolRunContext, UserMessage[]>()

  /** Executions whose tool body declared the current turn complete. */
  private concludingExecutions = new WeakSet<ToolExecution>()

  /** Original caller cancellation, kept outside the wrapper-mutable execution object. */
  private cancellationStates = new WeakMap<ToolRunContext, ToolCancellationState>()

  /** Definition-owned final content transform snapshotted before policy begins. */
  private contentFinalizers = new WeakMap<ToolRunContext, ToolDefinition['finalizeContent']>()

  /** Execution-prepared content installed before post-execute policy. */
  private contentProjectors = new WeakMap<ToolRunContext, ToolDefinition['projectContent']>()

  /** Owner captured with the definition-owned callbacks. */
  private contentOwners = new WeakMap<ToolExecution, string | null>()

  /**
   * Classify a pending call through the caller's visible tool definition. Only
   * an exact `true` is parallel; unknown, hidden, undeclared, invalid, or
   * throwing classifiers are exclusive.
   * @param exec - call name, parsed arguments, and optional agent scope.
   * @returns the fail-closed scheduling mode.
   */
  executionMode(exec: ToolExecutionInput): ToolExecutionMode {
    const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== undefined, exec.toolSet)
    if (!tool?.isConcurrencySafe) return { kind: 'exclusive' }
    try {
      const concurrencySafe: unknown = tool.isConcurrencySafe(exec.arguments)
      return concurrencySafe === true ? { kind: 'parallel' } : { kind: 'exclusive' }
    } catch {
      return { kind: 'exclusive' }
    }
  }

  /**
   * Append one log-only tool-pipeline event under failure containment. A
   * scheduler that owns an already-committed fact records it here; a failed
   * append only warns and never changes the scheduler's result or exception.
   * @param session - the owning agent's session; the append target.
   * @param type - one of the log-only `tool/*` keys declared in `./types.ts`.
   * @param build - constructs the payload only when an append will be attempted.
   */
  appendLogEvent<T extends ToolLogEventKey>(session: Session, type: T, build: () => SessionEventMap[T]): void {
    appendToolLogEvent(this.ctx.logger, session, type, build)
  }

  private createExecution(exec: ToolExecutionInput): ScheduledToolPreparation | { kind: 'ready'; exec: MutableToolRunContext } {
    const deferredContexts: UserMessage[] = []
    const token = createExecutionToken()
    const callId = exec.callId
    const rootCallId = exec.rootCallId ?? callId
    const name = exec.name
    const agent = exec.agent
    const parent = exec.parent
    const signal = exec.signal
    // Executor refusals precede extensible policy; unknown tools retain dispatch-stage handling.
    const visible = this.get(name, agent, exec.toolSet)
    const rejection = visible === undefined ? undefined : this.source.reject?.(name, parent !== undefined)
    const rejected = rejection !== undefined
    const concludingExecutions = this.concludingExecutions
    const base = {
      token,
      callId,
      rootCallId,
      name,
      signal,
      ...agent !== undefined ? { agent } : {},
      ...exec.toolSet !== undefined ? { toolSet: exec.toolSet } : {},
      ...exec.log !== undefined ? { log: exec.log } : {},
      ...parent !== undefined ? { parent } : {},
      ...exec.schema !== undefined ? { schema: exec.schema } : {},
      deferContext(context: UserMessage): void {
        deferredContexts.push(context)
      },
      concludeTurn(this: ToolExecution): void {
        concludingExecutions.add(this)
      },
    }
    // Capture callbacks before argument getters run; rejected calls retain finalization only when aborted.
    const capturedFinalizer = visible?.finalizeContent?.bind(visible)
    const capturedProjector = visible?.projectContent?.bind(visible)
    let owner: string | null = null
    try {
      owner = visible?.pluginOwner ?? visible?.name ?? null
    } catch (error: unknown) {
      this.ctx.logger.warn(`tool attribution failed: ${toolErrorMessage(error)}`)
    }
    const finalizerFor = (): ToolDefinition['finalizeContent'] | undefined =>
      rejected && !signal.aborted ? undefined : capturedFinalizer
    try {
      const detached = snapshotJsonValue(exec.arguments)
      if (detached === undefined) {
        throw new TypeError('tool execution arguments must be losslessly JSON-serializable')
      }
      const execution: MutableToolRunContext = { ...base, arguments: deepFreeze(detached) }
      this.contentOwners.set(execution, owner)
      this.deferredContexts.set(execution, deferredContexts)
      this.contentFinalizers.set(execution, finalizerFor())
      if (!rejected) this.contentProjectors.set(execution, capturedProjector)
      this.cancellationStates.set(execution, {
        callerSignal: signal,
        bodyInvoked: false,
      })
      if (rejected) {
        // Cancellation takes precedence over an executor refusal.
        if (signal.aborted) {
          return { kind: 'final-result', exec: execution, result: toolAbortedBeforeDispatchResult() }
        }
        return {
          kind: 'final-result',
          exec: execution,
          result: toolErrorResult(rejection),
        }
      }
      return { kind: 'ready', exec: execution }
    } catch (error: unknown) {
      const execution: MutableToolRunContext = { ...base, arguments: undefined }
      this.contentOwners.set(execution, owner)
      this.contentFinalizers.set(execution, finalizerFor())
      return { kind: 'final-result', exec: execution, result: toolErrorResult(error) }
    }
  }

  /**
   * Snapshot input, assign its correlation token, and run ordered pre-execute
   * policy and guards. Cancellation skips a body that has not started.
   * @param input - the caller-supplied execution input.
   * @returns the prepared execution plus the next scheduler stage.
   */
  async prepare(input: ToolExecutionInput): Promise<ScheduledToolPreparation> {
    const created = this.createExecution(input)
    if (created.kind !== 'ready') return created
    const exec = created.exec
    if (this.callerCancelled(exec)) {
      return { kind: 'final-result', exec, result: toolAbortedBeforeDispatchResult() }
    }
    try {
      const carrier = scopeTarget(this.tools, exec.agent)
      const gate = await this.ctx.waterfall(
        carrier, 'tools/pre-execute', exec,
        () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
      )
      const askResolution = gate.kind === 'ask'
        ? await this.serviceAsk(exec, gate)
        : { decision: gate, approvalCancelled: false }
      const { decision } = askResolution
      if (this.callerCancelled(exec) && askResolution.approvalCancelled) {
        return { kind: 'post-result', exec, result: toolAbortedBeforeDispatchResult() }
      }
      if (decision.kind === 'cancel') {
        return { kind: 'post-result', exec, result: toolAbortedBeforeDispatchResult() }
      }
      const denialReason = decision.kind === 'allow' ? this.tools.checkGuards(exec) : decision.reason
      const denialInfo = decision.kind === 'deny' ? decision.info : undefined
      if (denialReason !== undefined) {
        return {
          kind: 'post-result',
          exec,
          result: this.materializeFinalResult({
            content: [{ type: 'text', text: `Error: ${denialReason}` }],
            isError: true,
            error: { message: denialReason, ...denialInfo === undefined ? {} : { info: denialInfo } },
          }),
        }
      }
      if (this.callerCancelled(exec)) {
        return { kind: 'post-result', exec, result: toolAbortedBeforeDispatchResult() }
      }
      return { kind: 'dispatch', exec }
    } catch (error: unknown) {
      this.recordPipelineError(exec, 'pre-execute', error)
      return { kind: 'final-result', exec, result: toolErrorResult(error) }
    }
  }

  /** Whether the original caller signal is currently aborted. */
  private callerCancelled(exec: ToolRunContext): boolean {
    const state = this.cancellationStates.get(exec)
    /* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
    if (state === undefined) throw new Error('tool registry scheduler invariant violated: missing cancellation state')
    return state.callerSignal.aborted
  }

  /** Canonical cancellation outcome selected by whether the tool body started. */
  private cancellationResult(exec: ToolRunContext, prior?: ToolExecutionResult): ToolExecutionResult {
    const state = this.cancellationStates.get(exec)
    /* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
    if (state === undefined) throw new Error('tool registry scheduler invariant violated: missing cancellation state')
    return state.bodyInvoked
      ? toolAbortedResult(prior)
      : toolAbortedBeforeDispatchResult(prior)
  }

  /**
   * Dispatch the registered body with the original caller signal fused back
   * into any around-wrapper replacement. Cancellation never abandons the body:
   * a started promise reaches quiescence before its outcome becomes `ABORTED`.
   */
  private async dispatchToolBody(exec: MutableToolRunContext): Promise<ToolExecutionResult> {
    const state = this.cancellationStates.get(exec)
    /* v8 ignore next -- only registry-minted executions reach the staged scheduler methods */
    if (state === undefined) throw new Error('tool registry scheduler invariant violated: missing cancellation state')
    const wrapperSignal = exec.signal
    const fused = fuseToolSignals(state.callerSignal, wrapperSignal)
    const signal = fused.signal

    if (isAborted(signal)) {
      fused.dispose()
      return toolAbortedBeforeDispatchResult()
    }
    exec.signal = signal
    try {
      const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== undefined, exec.toolSet)
      if (!tool) throw new ToolNotFoundError(exec.name)
      state.bodyInvoked = true
      const returned = await tool.execute(exec.arguments, exec)
      const result = this.createSuccessResult(exec, tool, returned)
      return isAborted(signal)
        ? toolAbortedResult(result)
        : result
    } catch (error: unknown) {
      return toolErrorResult(error)
    } finally {
      fused.dispose()
      exec.signal = wrapperSignal
    }
  }

  /**
   * Run around-dispatch and the tool body. Tool and unknown-tool failures still
   * receive post-execute; pipeline failures are already final. Started bodies
   * drain on cancellation before a successful outcome becomes `ABORTED`.
   * @param exec - the execution returned by this pipeline's prepare stage.
   * @returns whether the result still needs post-execute.
   */
  async dispatch(exec: ToolRunContext): Promise<ScheduledToolDispatch> {
    try {
      const mutableExec = exec as MutableToolRunContext
      const carrier = scopeTarget(this.tools, exec.agent)
      const result = await this.ctx.waterfall(
        carrier, 'tools/execute', mutableExec,
        () => this.dispatchToolBody(mutableExec),
      )
      const normalized = this.normalizeDispatchResult(exec, result)
      const deferredContexts = this.deferredContexts.get(exec)
      /* v8 ignore next -- dispatch only receives executions minted by this registry's prepare stage */
      if (deferredContexts === undefined) throw new Error('tool registry scheduler invariant violated: unprepared execution')
      const resultWithDeferredContexts: ToolExecutionResult = deferredContexts.length === 0
        ? normalized
        : this.markCanonical(exec, {
          ...normalized,
          additionalContexts: [
            ...deferredContexts,
            ...normalized.additionalContexts ?? [],
          ],
        })
      return {
        kind: 'post-result',
        result: this.callerCancelled(exec) && !resultWithDeferredContexts.isError
          ? this.cancellationResult(exec, resultWithDeferredContexts)
          : resultWithDeferredContexts,
      }
    } catch (error: unknown) {
      this.recordPipelineError(exec, 'execute-wrapper', error)
      return { kind: 'final-result', result: toolErrorResult(error) }
    }
  }

  /**
   * Run post-execute when required, apply definition-owned content finalization,
   * and publish the lossless, frozen result. Policy and finalization failures
   * become error results. Cancellation replaces a successful outcome before
   * final materialization; tool-owned errors remain intact.
   * @param exec - the execution returned by this pipeline's prepare stage.
   * @param outcome - the preparation or dispatch result awaiting completion.
   * @returns the same materialized result delivered to final observers.
   */
  async complete(exec: ToolRunContext, outcome: ScheduledToolDispatch): Promise<ToolExecutionResult> {
    const stages: ToolResultRewriteStage[] = []
    switch (outcome.kind) {
      case 'final-result':
        return this.finish(exec, outcome.result, stages)
      case 'post-result':
        break
      /* v8 ignore next -- closed-union exhaustiveness guard */
      default:
        return assertNever(outcome, 'scheduled tool outcome')
    }
    const { result } = outcome
    /** Set when a stage already recorded its own failure, so the outer catch does not record it twice. */
    let recorded = false
    try {
      const project = this.contentProjectors.get(exec)
      this.contentProjectors.delete(exec)
      let content: ContentBlock[] | undefined
      try {
        content = project?.(exec, result)
      } catch (error: unknown) {
        this.recordPipelineError(exec, 'project', error)
        recorded = true
        throw error
      }
      let projected = result
      if (content !== undefined) {
        projected = this.markCanonical(exec, this.materializeFinalResult({ ...result, content }))
        this.captureRewriteStage(stages, () => ({
          stage: 'project',
          beforeDigest: contentDigest(result.content),
          digest: contentDigest(content),
          replacedField: 'content',
          listenerId: this.definitionOwner(exec),
        }))
      }
      const postResult = await this.postExecute(exec, projected, stages)
      return this.finish(
        exec,
        this.callerCancelled(exec) && !postResult.isError
          ? this.cancellationResult(exec, postResult)
          : postResult,
        stages,
      )
    } catch (error: unknown) {
      // A stage that already recorded its own failure rethrew without needing
      // this outer boundary to attribute it again.
      if (!recorded) this.recordPipelineError(exec, 'post-execute', error)
      return this.finish(exec, toolErrorResult(error), stages)
    }
  }

  /**
   * Materialize the candidate, apply definition-owned content finalization,
   * then materialize, record, and notify the authoritative result.
   * @param exec - the prepared execution.
   * @param result - final result.
   * @param stages - rewrites recorded so far, extended here when finalization replaces content.
   * @returns the materialized final result.
   * @internal
   */
  private finish(
    exec: ToolRunContext,
    result: ToolExecutionResult,
    stages: ToolResultRewriteStage[],
  ): ToolExecutionResult {
    let materializedResult: ToolExecutionResult
    try {
      materializedResult = this.materializeFinalResult(result)
    } catch (error: unknown) {
      this.recordPipelineError(exec, 'finalize', error)
      materializedResult = this.materializeFinalResult(toolErrorResult(error))
    }
    let finalResult: ToolExecutionResult
    try {
      const finalized = this.applyFinalContent(exec, materializedResult)
      finalResult = this.materializeFinalResult(finalized.result)
      if (finalized.rewritten !== undefined) {
        const rewritten = finalized.rewritten
        this.captureRewriteStage(stages, () => ({
          stage: 'finalize',
          beforeDigest: contentDigest(materializedResult.content),
          digest: contentDigest(rewritten),
          replacedField: 'content',
          listenerId: this.definitionOwner(exec),
        }))
      }
    } catch (error: unknown) {
      this.recordPipelineError(exec, 'finalize', error)
      finalResult = this.materializeFinalResult(toolErrorResult(error))
    }
    this.recordResultRewrite(exec, stages)
    this.notifyResult(exec, finalResult)
    return finalResult
  }

  /** Apply the snapshotted tool-owned content transform without exposing other result fields. */
  private applyFinalContent(
    exec: ToolRunContext,
    result: ToolExecutionResult,
  ): { result: ToolExecutionResult; rewritten: ContentBlock[] | undefined } {
    const finalizeContent = this.contentFinalizers.get(exec)
    if (finalizeContent === undefined) return { result, rewritten: undefined }
    const content = finalizeContent(exec, result)
    return content === undefined ? { result, rewritten: undefined } : { result: { ...result, content }, rewritten: content }
  }

  /**
   * Name the definition that owns a content callback for this call.
   * `projectContent` and `finalizeContent` are declared by the tool definition,
   * so the rewriting component is that tool: its declared `pluginOwner`, or the
   * tool name when the definition declares no owner.
   * @param exec - the execution whose result a definition-owned callback rewrote.
   * @returns the captured plugin id or tool name, or null if unavailable.
   */
  private definitionOwner(exec: ToolExecution): string | null {
    return this.contentOwners.get(exec) ?? null
  }

  /**
   * Record one internal stage-boundary failure under containment.
   * @param exec - the execution whose stage failed.
   * @param stage - the internal boundary that caught the failure.
   * @param error - the caught value.
   */
  private recordPipelineError(exec: ToolExecution, stage: ToolPipelineErrorEventData['stage'], error: unknown): void {
    const session = exec.agent?.session
    if (session === undefined) return
    // Only the definition-owned stages have a nameable thrower; a waterfall
    // listener or an execute wrapper is anonymous on this seam.
    const definitionOwned = stage === 'project' || stage === 'finalize'
    appendToolLogEvent(this.ctx.logger, session, 'tool/pipeline-error', () => ({
      sessionId: session.id,
      turn: exec.log?.turn ?? null,
      step: exec.log?.step ?? null,
      callId: exec.callId,
      stage,
      message: toolErrorMessage(error),
      error: error instanceof HarnessError ? { name: error.name, code: error.code } : null,
      thrower: definitionOwned ? this.definitionOwner(exec) : null,
    }))
  }

  private captureRewriteStage(stages: ToolResultRewriteStage[], build: () => ToolResultRewriteStage): void {
    try {
      stages.push(build())
    } catch (error: unknown) {
      this.ctx.logger.warn(`tool result rewrite observation failed: ${toolErrorMessage(error)}`)
    }
  }

  /**
   * Record one settled result's stage-level rewrites under failure containment.
   * One event per result, stages in pipeline order; nothing is recorded when no
   * stage replaced content or the execution has no owning Session.
   * @param exec - the execution whose result settled.
   * @param stages - rewrites observed while settling it.
   */
  private recordResultRewrite(exec: ToolExecution, stages: readonly ToolResultRewriteStage[]): void {
    if (stages.length === 0) return
    const session = exec.agent?.session
    if (session === undefined) return
    appendToolLogEvent(this.ctx.logger, session, 'tool/result-rewrite', () => ({
      sessionId: session.id,
      turn: exec.log?.turn ?? null,
      step: exec.log?.step ?? null,
      callId: exec.callId,
      stages,
    }))
  }

  /** Notify observers without exposing a mutation or error channel into the outcome. */
  private notifyResult(exec: ToolExecution, result: ToolExecutionResult): void {
    // Freeze the registry's live object before observers receive its readonly
    // WeakMap-keyable view.
    Object.freeze(exec)
    const { name: toolName, callId } = exec
    const reportFailure = (error: unknown): void => {
      this.ctx.logger.warn(`tool "${toolName}" (${callId}): tools/result observer failed: ${toolErrorMessage(error)}`)
    }
    const callbacks = this.ctx.events.dispatch('emit', [
      scopeTarget(this.tools, exec.agent), 'tools/result', exec, result,
    ])
    for (const callback of callbacks) {
      try {
        const returned: unknown = callback(exec, result)
        void Promise.resolve(returned).catch(reportFailure)
      } catch (error: unknown) {
        reportFailure(error)
      }
    }
  }

  /**
   * Record an ask that degraded before the approval seam ran, without affecting
   * the deny it accompanies. An agent-less execution owns no Session, so the
   * record is skipped rather than attached elsewhere.
   * @param exec - the execution whose ask degraded.
   * @param reason - the missing precondition.
   * @param askReason - the asking policy's own reason, when supplied.
   */
  private recordApprovalUnavailable(
    exec: ToolExecution,
    reason: 'no-approval-service' | 'no-agent',
    askReason: string | null,
  ): void {
    const session = exec.agent?.session
    if (session === undefined) return
    appendToolLogEvent(this.ctx.logger, session, 'approval/unavailable', () => ({
      sessionId: session.id,
      turn: exec.log?.turn ?? null,
      step: exec.log?.step ?? null,
      callId: exec.callId,
      toolName: exec.name,
      reason,
      askReason,
    }))
  }

  /**
   * Resolve an `ask` decision to allow/deny through the approval seam. The
   * seam is consumed opportunistically with `ctx.get('approval')` — a
   * deployment that composes no ApprovalService keeps the historical degrade
   * to deny, and an unmount mid-session degrades the same way on the next ask.
   * An agent-less execution also degrades: without an agent there is no
   * session to audit to and no UI to route to. Otherwise the outcome maps
   * one-to-one — `allowed-once` proceeds; the three non-grants deny with
   * distinct reasons so the model can tell a human "no" from an absent
   * approval channel.
   */
  private async serviceAsk(
    exec: ToolExecution,
    ask: Extract<PreToolDecision, { kind: 'ask' }>,
  ): Promise<ToolAskResolution> {
    const approval = this.ctx.get('approval')
    if (approval === undefined) {
      this.recordApprovalUnavailable(exec, 'no-approval-service', ask.reason ?? null)
      return {
        decision: { kind: 'deny', reason: ask.reason ?? `tool "${exec.name}" requires approval (not yet supported)` },
        approvalCancelled: false,
      }
    }
    if (exec.agent === undefined) {
      this.recordApprovalUnavailable(exec, 'no-agent', ask.reason ?? null)
      return {
        decision: { kind: 'deny', reason: `tool "${exec.name}" requires approval, but the call has no agent to route it through` },
        approvalCancelled: false,
      }
    }
    const outcome = await approval.request({
      agent: exec.agent,
      toolName: exec.name,
      callId: exec.callId,
      ...ask.reason !== undefined ? { reason: ask.reason } : {},
      ...ask.displayReason !== undefined ? { displayReason: ask.displayReason } : {},
      signal: exec.signal,
    })
    switch (outcome) {
      case 'allowed-once': return { decision: { kind: 'allow' }, approvalCancelled: false }
      case 'rejected': return {
        decision: { kind: 'deny', reason: `the user rejected tool "${exec.name}"` },
        approvalCancelled: false,
      }
      case 'cancelled': return {
        decision: { kind: 'deny', reason: `approval for tool "${exec.name}" was cancelled` },
        approvalCancelled: true,
      }
      case 'unavailable': return {
        decision: { kind: 'deny', reason: `tool "${exec.name}" requires approval, but no approval channel is available` },
        approvalCancelled: false,
      }
      default: return assertNever(outcome, 'ApprovalOutcome')
    }
  }

  /**
   * Run the `tools/post-execute` waterfall over a dispatched `result` and apply
   * its {@link PostToolDecision}: `accept` keeps the call successful (replacing
   * `content` when given), `block` turns it into an `isError` whose content is
   * the corrective `feedback`. Either decision may attach `additionalContexts`,
   * which are ferried on the returned result for the loop's active-batch FIFO.
   * Context deferred by the tool body survives an accepted result but is
   * discarded when the outer call is blocked; a block exposes only context the
   * blocking decision explicitly supplied.
   * Runs inside `execute`'s outer try/catch (a throwing listener → isError).
   */
  private async postExecute(
    exec: ToolExecution,
    result: ToolExecutionResult,
    stages: ToolResultRewriteStage[],
  ): Promise<ToolExecutionResult> {
    const decision = await this.ctx.waterfall(
      scopeTarget(this.tools, exec.agent), 'tools/post-execute', exec, result,
      () => Promise.resolve<PostToolDecision>({ kind: 'accept' }),
    )
    const decisionContexts = decision.additionalContexts ?? []
    if (decision.kind === 'block') {
      const message = failureMessageFromContent(decision.feedback)
      const blocked = this.markCanonical(exec, {
        content: decision.feedback,
        isError: true,
        error: { message },
        ...decisionContexts.length > 0 ? { additionalContexts: decisionContexts } : {},
      })
      this.captureRewriteStage(stages, () => ({
        stage: 'post-execute',
        beforeDigest: contentDigest(result.content),
        digest: contentDigest(blocked.content),
        replacedField: 'content',
        listenerId: null,
      }))
      return blocked
    }
    if (Object.hasOwn(decision, 'content') && Object.hasOwn(decision, 'value')) {
      throw new TypeError('tools/post-execute accept decision cannot replace both value and content')
    }
    const additionalContexts = [
      ...result.additionalContexts ?? [],
      ...decisionContexts,
    ]
    if (Object.hasOwn(decision, 'value')) {
      if (result.isError) {
        throw new TypeError('tools/post-execute cannot replace the value of a failed result')
      }
      const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== undefined, exec.toolSet)
      if (tool === undefined) throw new ToolNotFoundError(exec.name)
      const replaced = this.createSuccessResult(exec, tool, decision.value)
      const next = this.markCanonical(exec, {
        ...replaced,
        ...additionalContexts.length > 0 ? { additionalContexts } : {},
      })
      this.captureRewriteStage(stages, () => ({
        stage: 'post-execute',
        beforeDigest: contentDigest(result.content),
        digest: contentDigest(next.content),
        replacedField: 'value',
        listenerId: null,
      }))
      return next
    }
    const next = this.markCanonical(exec, {
      ...result,
      ...decision.content !== undefined ? { content: decision.content } : {},
      ...additionalContexts.length > 0 ? { additionalContexts } : {},
    })
    if (decision.content !== undefined) {
      this.captureRewriteStage(stages, () => ({
        stage: 'post-execute',
        beforeDigest: contentDigest(result.content),
        digest: contentDigest(next.content),
        replacedField: 'content',
        listenerId: null,
      }))
    }
    return next
  }

  /** Registry-normalized results and the exact dispatch that validated each value. */
  private readonly canonicalResults = new WeakMap<object, ToolExecutionToken>()

  /** Mark one registry-normalized result as canonical only for its owning dispatch. */
  private markCanonical<T extends ToolExecutionResult>(exec: ToolExecution, result: T): T {
    this.canonicalResults.set(result, exec.token)
    return result
  }

  /** Snapshot, validate, render, and optionally project one successful body value. */
  private createSuccessResult(exec: ToolExecution, tool: ToolDefinition, candidate: unknown): ToolExecutionSuccess {
    const detached = snapshotToolValue(tool.name, candidate)
    const violations = validateJsonSchemaValue(tool.output.schema, detached, 'value')
    if (violations.length > 0) throw new ToolOutputError(tool.name, violations)
    const value = deepFreeze(detached)
    let rendered: ContentBlock[]
    try {
      rendered = tool.output.render(exec.arguments, value)
    } catch (error: unknown) {
      throw projectionError(tool.name, 'render', error)
    }
    const content = snapshotProjection(tool.name, 'render', rendered)
    let meta: JsonValue | undefined
    if (tool.output.presentationMeta !== undefined) {
      let projected: JsonValue
      try {
        projected = tool.output.presentationMeta(exec.arguments, value)
      } catch (error: unknown) {
        throw projectionError(tool.name, 'presentationMeta', error)
      }
      meta = snapshotProjection(tool.name, 'presentationMeta', projected)
    }
    const concludesTurn = this.concludingExecutions.has(exec)
    return this.markCanonical(exec, this.materializeFinalResult({
      isError: false,
      value,
      content,
      ...meta !== undefined ? { meta } : {},
      ...concludesTurn ? { concludesTurn: true as const } : {},
    }) as ToolExecutionSuccess)
  }

  /** Normalize an around-dispatch wrapper's authored result through the owning output contract. */
  private normalizeDispatchResult(exec: ToolExecution, result: ToolExecutionResult): ToolExecutionResult {
    if (this.canonicalResults.get(result) === exec.token) return result
    if (result.isError) {
      return this.markCanonical(exec, {
        isError: true,
        error: result.error,
        content: result.content,
        ...result.meta !== undefined ? { meta: result.meta } : {},
        ...result.additionalContexts !== undefined ? { additionalContexts: result.additionalContexts } : {},
      })
    }
    const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== undefined, exec.toolSet)
    if (tool === undefined) throw new ToolNotFoundError(exec.name)
    const normalized = this.createSuccessResult(exec, tool, result.value)
    return this.markCanonical(exec, {
      ...normalized,
      ...result.additionalContexts !== undefined ? { additionalContexts: result.additionalContexts } : {},
    })
  }

  /** Materialize the authoritative commit outcome once, immediately before `tools/result`. */
  private materializeFinalResult(result: ToolExecutionResult): ToolExecutionResult {
    const presentation = {
      content: result.content,
      ...result.meta !== undefined ? { meta: result.meta } : {},
      ...result.additionalContexts !== undefined ? { additionalContexts: result.additionalContexts } : {},
    }
    if (result.isError) {
      return materializePresentation({ isError: true as const, error: result.error, ...presentation })
    }
    const detached = materializePresentation({
      isError: false as const,
      ...presentation,
      ...result.concludesTurn === true ? { concludesTurn: true as const } : {},
    })
    return deepFreeze({ ...detached, value: result.value })
  }
}

/** Convert one projector exception into the canonical invalid-output failure. */
function projectionError(toolName: string, projector: 'render' | 'presentationMeta', error: unknown): ToolOutputError {
  return new ToolOutputError(toolName, [`output.${projector} failed: ${toolErrorMessage(error)}`])
}

/**
 * Digest one stage's replacement content so a replay can match the rewrite.
 * @param content - the stage's replacement content blocks.
 * @returns the SHA-256 hex digest of the JSON-encoded blocks.
 */
function contentDigest(content: readonly ContentBlock[]): string {
  return createHash('sha256').update(JSON.stringify(content)).digest('hex')
}

/** Snapshot one projector result before later durable-result materialization. */
function snapshotProjection<T>(toolName: string, projector: 'render' | 'presentationMeta', candidate: T): T {
  try {
    const detached = snapshotJsonValue(candidate)
    if (detached === undefined) {
      throw new ToolOutputError(toolName, [`output.${projector} returned non-lossless JSON`])
    }
    return detached
  } catch (error: unknown) {
    if (error instanceof ToolOutputError) throw error
    throw projectionError(toolName, projector, error)
  }
}

/** Snapshot one body or policy value into the canonical invalid-output failure class. */
function snapshotToolValue(toolName: string, candidate: unknown): JsonValue {
  try {
    const detached = snapshotJsonValue(candidate)
    if (detached === undefined) throw new ToolOutputError(toolName, ['value is not lossless JSON'])
    return detached as JsonValue
  } catch (error: unknown) {
    if (error instanceof ToolOutputError) throw error
    throw new ToolOutputError(toolName, [`value snapshot failed: ${toolErrorMessage(error)}`])
  }
}

/**
 * Best-effort human-readable message from an arbitrary thrown value: Error
 * instances use `.message`; non-Error objects with a string `message`
 * property (e.g. `throw { message: 'denied' }`) use it too; everything else
 * is stringified.
 * @param error - thrown value from a tool or policy callback.
 * @returns a printable failure message, including for hostile thrown values.
 */
export function toolErrorMessage(error: unknown): string {
  try {
    if (error instanceof Error) return error.message
    if (typeof error === 'object' && error !== null
      && 'message' in error && typeof error.message === 'string') {
      return error.message
    }
    return String(error)
  } catch {
    // A hostile thrown value can trap `instanceof`, property access, or string
    // coercion. Error normalization is the outermost safety boundary, so its
    // fallback must itself be total.
    return '<unprintable thrown value>'
  }
}

/** Derive one failure message from policy feedback without changing its rendered blocks. */
function failureMessageFromContent(content: ContentBlock[]): string {
  const text = content
    .map(block => block.type === 'text' ? block.text : `[${block.type} content]`)
    .join('\n')
  return text.length > 0 ? text : 'tool result blocked by post-execute policy'
}

/** Snapshot and freeze one durable tool-result projection or reject lossy data. */
function materializePresentation<T>(candidate: T): T {
  const detached = snapshotJsonValue(candidate)
  if (detached === undefined) {
    throw new TypeError('tool result must be losslessly JSON-serializable')
  }
  return deepFreeze(detached)
}

/** Structured `{ name, code }` for a thrown HarnessError, else undefined. */
function errorInfo(error: unknown): ToolErrorInfo | undefined {
  try {
    return error instanceof HarnessError ? { name: error.name, code: error.code } : undefined
  } catch {
    return undefined
  }
}

/** Mint a same-process correlation token whose identity is its value. */
function createExecutionToken(): ToolExecutionToken {
  return Symbol('dsh.tool.execution') as ToolExecutionToken
}

function toolErrorResult(error: unknown): ToolExecutionResult {
  const info = errorInfo(error)
  const message = toolErrorMessage(error)
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
    error: { message, ...info ? { info } : {} },
  }
}

/** Read live abort state across an await without treating it as synchronously immutable. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/**
 * Fuse caller and wrapper cancellation without nesting `AbortSignal.any`.
 * Keeping the relay dispatch-scoped also removes listeners when work settles.
 */
function fuseToolSignals(caller: AbortSignal, wrapper: AbortSignal): FusedToolSignal {
  if (caller === wrapper) return { signal: caller, dispose() {} }

  const controller = new AbortController()
  let listening = false
  const dispose = (): void => {
    if (!listening) return
    listening = false
    caller.removeEventListener('abort', abortFromCaller)
    wrapper.removeEventListener('abort', abortFromWrapper)
  }
  const abortFrom = (source: AbortSignal): void => {
    const reason: unknown = source.reason
    controller.abort(reason)
    dispose()
  }
  const abortFromCaller = (): void => { abortFrom(caller) }
  const abortFromWrapper = (): void => { abortFrom(wrapper) }

  if (wrapper.aborted) abortFromWrapper()
  else if (caller.aborted) abortFromCaller()
  else {
    listening = true
    caller.addEventListener('abort', abortFromCaller, { once: true })
    wrapper.addEventListener('abort', abortFromWrapper, { once: true })
  }
  return { signal: controller.signal, dispose }
}

/** Canonical result when cancellation supersedes success after body invocation. */
function toolAbortedResult(prior?: ToolExecutionResult): ToolExecutionResult {
  const additionalContexts = prior?.additionalContexts ?? []
  return {
    content: [{ type: 'text', text: 'Error: tool call aborted' }],
    isError: true,
    error: {
      message: 'tool call aborted',
      info: { name: 'AbortError', code: TOOL_ABORTED },
    },
    ...additionalContexts.length > 0 ? { additionalContexts } : {},
  }
}

/** Canonical result when cancellation prevents tool body invocation. */
function toolAbortedBeforeDispatchResult(prior?: ToolExecutionResult): ToolExecutionResult {
  const additionalContexts = prior?.additionalContexts ?? []
  return {
    content: [{ type: 'text', text: 'Error: tool call aborted before dispatch' }],
    isError: true,
    error: {
      message: 'tool call aborted before dispatch',
      info: { name: 'AbortError', code: TOOL_ABORTED_BEFORE_DISPATCH },
    },
    ...additionalContexts.length > 0 ? { additionalContexts } : {},
  }
}

export { executeToolBatch } from './batch.ts'
