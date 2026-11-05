/**
 * Log-only tool-pipeline session events owned by `@deepseek-ai/dsh-tools`. Each
 * records a fact the external trajectory probe cannot observe from public
 * waterfalls: the per-stage tool-catalog admission digest (#7), the executor
 * attribution behind a settled batch (#20), the in-batch scheduling plan (#26),
 * the stage-level result rewrite (#21), and the internal stage-boundary error
 * (#22). Every member is non-surface: none is in the {@link SurfaceEventType}
 * union, so none carries `SurfaceOp` and `deriveMessages()` ignores it.
 *
 * Declaration-merged into `SessionEventMap` in this package's own vocabulary,
 * mirroring `dsh-llm-retry`'s `llm/retry` and `dsh-tool-executor-ptc`'s
 * `tool/ptc-dispatch` pattern. `gen-persistence-catalog` auto-discovers the
 * merge; no manual registry step. One fact producer per recording point: the
 * probe keeps only the call-id → turn/step association index and never writes
 * these facts, so a release-package event and the probe never duplicate.
 * @module @deepseek-ai/dsh-tools
 */
import type { ToolCallId } from '@deepseek-ai/dsh-llm'

/** One stage's reason a visible registration was not admitted to a step. @see ToolCatalogResolvedEventData */
export interface ToolCatalogSkipReason {
  /** The tool name as registered. */
  readonly name: string
  /**
   * Why the visible registration was excluded: `'restriction'` (a `restrict()`
   * filter masked a global), `'when'` (the step-time condition returned false),
   * or `'when-error'` (the condition threw — the step aborts with
   * `ToolActivationError`; the digest records the exclusion for diagnosis).
   */
  readonly reason: 'restriction' | 'when' | 'when-error'
}

/**
 * Durable payload for `tool/catalog-resolved` (#7): the final admitted tool set
 * digest and per-stage skip reasons from one `ToolsService.resolve()` pass. The
 * registry resolves conditions once per step; this records the outcome the
 * probe cannot see because registry restriction, the `when` condition, and
 * executor admission are not public waterfalls. `turn`/`step` are intentionally
 * absent: `resolve()` runs before the step counter is committed and the
 * `ToolActivationContext` carries no position; the trajectory probe's
 * session/turn/step index built from the public `turn/start` and `step/start`
 * boundaries already owns that association, so the release event records the
 * digest only and never duplicates the position.
 */
export interface ToolCatalogResolvedEventData {
  /** The owning agent's session id. */
  readonly sessionId: string
  /** Admitted tool names in stable registration order. */
  readonly admitted: readonly string[]
  /** Visible registrations excluded this pass, with the excluding stage. */
  readonly skipped: readonly ToolCatalogSkipReason[]
  /** A stable digest of the admitted set, so a replay can match a catalog row. */
  readonly digest: string
}

/**
 * Durable payload for `tool/catalog-exposed` (#7, executor stage): the schemas
 * the selected executor actually exposed for one step assembly.
 * `tool/catalog-resolved` records what the registry admitted; an executor may
 * collapse or filter that set (PTC exposes only `run_code`), and the model sees
 * only the schemas `describe()` returned. The probe cannot observe that call
 * because it runs inside the registry's own prompt provider. Same position
 * caveat as `tool/catalog-resolved`: the digests carry no turn/step.
 */
export interface ToolCatalogExposedEventData {
  /** The owning agent's session id. */
  readonly sessionId: string
  /** Names the registry admitted for this step, in registration order. */
  readonly admitted: readonly string[]
  /** Schema names the executor exposed to the model, in executor order. */
  readonly exposed: readonly string[]
  /** A stable digest of the exposed set, so a replay can match a catalog row. */
  readonly digest: string
  /**
   * One digest per exposed schema, keyed by name, over the full schema the
   * executor handed the model (name, description, parameters, and
   * `deferLoading`). The set digest above proves *which* tools were visible;
   * these prove *what each tool looked like*, so a replay can tell a changed
   * description or parameter from an unchanged one without storing the schema.
   */
  readonly schemaDigests?: Readonly<Record<string, string>>
}

/** One call's declared ownership within a settled batch. @see ToolResultAttributionEventData */
export interface ToolResultAttributionCall {
  /** The model call id. */
  readonly callId: ToolCallId
  /** Plugin id owning the call's definition, when the definition declares one. */
  readonly pluginOwner: string | null
  /** Provider id the call's definition dispatches through, when it declares one. */
  readonly providerId: string | null
}

/**
 * Durable payload for `tool/result-attribution` (#20): which executor settled
 * a batch and, when the tool definitions or executor declare ownership, the
 * owning plugin/provider ids. The probe sees the result but not the executor
 * selection (`selectExecutor` is a private registry method).
 * `executorId` is the executor's declared `ToolExecutor.executorId`; an
 * undeclared executor records null instead of a constructor name. Ownership is
 * recorded per call: one batch may mix definitions from different plugins, so
 * no batch-wide owner is fabricated. Undeclared definitions leave their fields
 * null and the record stays `partial` for them (the plan's
 * complete-for-declarers / partial-for-undeclared split).
 */
export interface ToolResultAttributionEventData {
  /** The owning agent's session id. */
  readonly sessionId: string
  /** The turn the batch committed to, when logged. */
  readonly turn: number | null
  /** The step the batch committed to, when logged. */
  readonly step: number | null
  /** The selected executor's declared id, when it declares one. */
  readonly executorId: string | null
  /** Per-call definition ownership in model order. */
  readonly calls: readonly ToolResultAttributionCall[]
}

/** One call's reclassification within a batch group. @see ToolExecutionPlanEventData */
export interface ToolExecutionPlanReclass {
  /** The call id that changed classification. */
  readonly callId: ToolCallId
  /** The new scheduling mode. */
  readonly mode: 'parallel' | 'exclusive'
}

/**
 * Durable payload for `tool/execution-plan` (#26): the in-batch scheduling plan
 * at group start, reclassification, and commit. Batch classification and the
 * bounded pool are internal to `executeToolBatch`; the probe sees only the
 * settled phenomena. Three phases write one event each: `start` (the group's
 * calls and initial mode), `reclassify` (a call reclassified before start), and
 * `commit` (the model-ordered outcomes). `consumed`/`concluded` are present at
 * `commit`; absent otherwise (flat JSON, no conditional spread).
 */
export interface ToolExecutionPlanEventData {
  /** The owning agent's session id, when the batch has one. */
  readonly sessionId: string | null
  /** The turn the batch committed to, when logged. */
  readonly turn: number | null
  /** The step the batch committed to, when logged. */
  readonly step: number | null
  /** `start` at group entry, `reclassify` on a mid-group mode change, `commit` at model-ordered settlement. */
  readonly phase: 'start' | 'reclassify' | 'commit'
  /** Calls in the group at this phase, with their mode. */
  readonly calls: readonly { callId: ToolCallId; mode: 'parallel' | 'exclusive' }[]
  /** A reclassification at the `reclassify` phase; absent at `start`/`commit`. */
  readonly reclassified: ToolExecutionPlanReclass | null
  /**
   * The call that formed an exclusive barrier, stopping the parallel pool from
   * starting further calls behind it. Present at `reclassify`, where the
   * scheduler observes the barrier; absent at `start`/`commit` (there the group's
   * mode is already carried per call).
   */
  readonly exclusiveBarrier?: ToolCallId | null
  /** Calls consumed from the group; present only at `commit`. */
  readonly consumed: number | null
  /** Whether any committed result concluded the turn; present only at `commit`. */
  readonly concluded: boolean | null
}

/** One stage-level rewrite of a settled result. @see ToolResultRewriteEventData */
export interface ToolResultRewriteStage {
  /** The pipeline stage that rewrote the result: `project`, `post-execute`, or `finalize`. */
  readonly stage: 'project' | 'post-execute' | 'finalize'
  /** A digest of the content entering this stage, so a replay can tell the rewrite apart. */
  readonly beforeDigest?: string
  /** A digest of the stage's output content, so a replay can match the rewrite. */
  readonly digest: string
  /** Which result field the stage replaced. */
  readonly replacedField?: 'content' | 'value'
  /**
   * Identifies the component that produced this stage's rewrite, when one can be
   * named. `project`/`finalize` are definition-owned callbacks, so the value is
   * the rewriting tool's `pluginOwner` when the definition declares one and the
   * tool name otherwise; `post-execute` is the aggregate waterfall decision and
   * stays null because no single listener owns the replacement. External
   * listeners remain `partial` (the plan's complete-for-built-in /
   * partial-for-external split).
   */
  readonly listenerId: string | null
}

/**
 * Durable payload for `tool/result-rewrite` (#21): the stage-level rewrites a
 * settled result passed through. The three tool waterfalls expose only the
 * aggregate decision, not which stage or listener rewrote the content; this
 * records the per-stage digest and the built-in listener id when the rewrite is
 * pipeline-owned. External listeners are not attributed (the probe does not
 * read Cordis internals) and leave `listenerId` null.
 */
export interface ToolResultRewriteEventData {
  /** The owning agent's session id, when the batch has one. */
  readonly sessionId: string | null
  /** The turn the batch committed to, when logged. */
  readonly turn: number | null
  /** The step the batch committed to, when logged. */
  readonly step: number | null
  /** The call id whose result was rewritten. */
  readonly callId: ToolCallId
  /** Stages that rewrote the result, in pipeline order. */
  readonly stages: readonly ToolResultRewriteStage[]
}

/**
 * Durable payload for `tool/pipeline-error` (#22): an error at an internal
 * pipeline stage boundary (`project` or `finalize`) that the three tool
 * waterfalls do not expose. The pipeline catches these and converts them to an
 * `isError` result; this records the stage and the error message so the
 * trajectory knows the failure was internal rather than tool-owned. The thrower
 * is undeclared (no public identity for an arbitrary projector/finalizer), so
 * `thrower` stays null — the recording point is `complete` for the stage and
 * `partial` for the thrower, per the plan.
 */
export interface ToolPipelineErrorEventData {
  /** The owning agent's session id, when the batch has one. */
  readonly sessionId: string | null
  /** The turn the batch committed to, when logged. */
  readonly turn: number | null
  /** The step the batch committed to, when logged. */
  readonly step: number | null
  /** The call id whose pipeline threw. */
  readonly callId: ToolCallId
  /**
   * The internal stage boundary where the error was caught. `pre-execute` is the
   * `tools/pre-execute` waterfall (policy, approval, guard); `execute-wrapper`
   * is the `tools/execute` chain around the tool body; `project`,
   * `post-execute`, and `finalize` are the result-shaping stages. This union is
   * open within one format version: a reader that meets an unrecognized stage
   * still knows the failure was internal and must not reject the record.
   */
  readonly stage: 'pre-execute' | 'execute-wrapper' | 'project' | 'post-execute' | 'finalize'
  /** The error message, normalized through `toolErrorMessage`. */
  readonly message: string
  /** Structured `{ name, code }` for a thrown HarnessError, else null. */
  readonly error: { name: string; code: string } | null
  /**
   * The component that threw, when it can be named. A definition-owned callback
   * (`projectContent`/`finalizeContent`) identifies its tool: the declared
   * `pluginOwner`, or the tool name without one. Waterfall and wrapper stages
   * stay null because the thrower is an anonymous listener with no public
   * identity, so the record remains `partial` for them.
   */
  readonly thrower: string | null
}

/**
 * Durable payload for `approval/unavailable` (#44): an `ask` decision that
 * degraded to deny before the approval seam ran — no composed ApprovalService,
 * or no agent to attach the audit and route the UI. The probe sees the
 * downstream deny result but not this pre-`serviceAsk` branch. An agent-less
 * execution owns no Session, so only the no-service branch can record.
 */
export interface ApprovalUnavailableEventData {
  /** The owning agent's session id. */
  readonly sessionId: string
  /** The turn the call committed to, when logged. */
  readonly turn: number | null
  /** The step the call committed to, when logged. */
  readonly step: number | null
  /** The call whose ask degraded. */
  readonly callId: ToolCallId
  /** The requested tool name. */
  readonly toolName: string
  /** Which precondition was missing: a composed ApprovalService, or an Agent. */
  readonly reason: 'no-approval-service' | 'no-agent'
  /** The asking policy's own reason, when it supplied one. */
  readonly askReason: string | null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Final admitted tool-set digest and per-stage skip reasons from one
     * `ToolsService.resolve()` pass. Log-only: the model sees only the admitted
     * schemas; restriction and `when` exclusion are not public. `turn`/`step`
     * are absent (resolve runs before the step counter is committed); the
     * trajectory probe owns the position association.
     * @param data - the admitted-set digest and skip reasons.
     */
    'tool/catalog-resolved': ToolCatalogResolvedEventData
    /**
     * The schemas the selected executor exposed for one step assembly, plus the
     * registry-admitted names behind them. Log-only: `describe()` runs inside
     * the registry's prompt provider and an executor may collapse the admitted
     * set (PTC exposes only `run_code`). The model sees only these schemas.
     * `turn`/`step` are absent for the same reason as `tool/catalog-resolved`.
     * @param data - the exposure's admitted names, exposed schema names, and digest.
     */
    'tool/catalog-exposed': ToolCatalogExposedEventData
    /**
     * Executor attribution behind one settled batch: the selected executor's
     * declared identity and, per call, the definition's declared plugin owner
     * and dispatch provider id. Log-only: executor selection is a private
     * registry method. Stays `partial` for undeclared ownership.
     * @param data - the executor identity and per-call ownership for the batch.
     */
    'tool/result-attribution': ToolResultAttributionEventData
    /**
     * In-batch scheduling plan at group start, reclassification, and commit.
     * Log-only: batch classification and the bounded pool are internal to
     * `executeToolBatch`. One event per phase; `consumed`/`concluded` present
     * only at `commit`.
     * @param data - the scheduling plan for one group phase.
     */
    'tool/execution-plan': ToolExecutionPlanEventData
    /**
     * Stage-level rewrites a settled result passed through (`project`,
     * `post-execute`, `finalize`), with a per-stage digest and the built-in
     * listener id when pipeline-owned. Log-only: the waterfalls expose only the
     * aggregate decision. External listeners stay `partial`.
     * @param data - the per-stage rewrites for one settled result.
     */
    'tool/result-rewrite': ToolResultRewriteEventData
    /**
     * An error caught at an internal pipeline stage boundary (`project` or
     * `finalize`) that the tool waterfalls do not expose. Log-only: the pipeline
     * converts these to an `isError` result; this records that the failure was
     * internal. `thrower` is null when the thrower is undeclared.
     * @param data - the stage-boundary error for one settled result.
     */
    'tool/pipeline-error': ToolPipelineErrorEventData
    /**
     * An `ask` decision that degraded to deny before the approval seam ran:
     * no composed ApprovalService, or no agent to route it through. Log-only:
     * the probe sees only the downstream deny result. An agent-less execution
     * owns no Session, so such a record is never attempted.
     * @param data - the degraded ask's call identity and missing precondition.
     */
    'approval/unavailable': ApprovalUnavailableEventData
  }
}
