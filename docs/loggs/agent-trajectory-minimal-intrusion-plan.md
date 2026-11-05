# DeepSeek Harness Agent Trajectory Instrumentation: Probe First + Point Fixes Technical Plan

English | [中文](agent-trajectory-minimal-intrusion-plan.zh.md)

This plan is organized as "probe first + point fixes" with no parallel tracks. An external probe plugin owned by AutoEval records by default; only facts the probe cannot obtain through public events, public services, or public waterfall wrapping receive a point fix at the fact's owner. Each recording point has exactly one fact producer, and the probe and point-fix code never write two records for the same fact.

"Complete recording" is defined per recording point: every field the current applicable scenario requires has a real source, coverage is `complete`, and `missing=[]`. External listeners, answerers that do not self-report identity, and facts internal to third-party wrappers can only be recorded as `partial` with the missing fields listed; a point with no corresponding mechanism is recorded as `not_applicable`. Partial points do not count toward the complete numerator and are never completed by guesswork.

This document is a design draft; it has not been reviewed, implemented, or tested. The plan covers only DSH-side fact production and probe persistence; AutoEval's child-session collection, post-idle catch-up reads, and Langfuse writes are out of scope.

## Execution conventions

- Version and date: v0.3, 2026-10-28.
- Baseline: `/home/Project/Harness/Deepseek-Harness`, release tag `v0.2.2-alpha.2`.
- Business index: [Agent trajectory persisted event master table](../../../AutoEval/docs/logging-plan/agent-trajectory-persistence-events.md).
- Requirement source: the user asked for a complete plan rewritten around "probe first + point fixes", without parallel tracks, preferring an external probe for complete instrumentation.
- Readers and purpose: for DSH and AutoEval maintainers to review recording contracts, point fixes, and acceptance; it authorizes neither coding, installation, real model calls, nor release.
- Fixed constraints: do not modify `vendor/`; do not change business behavior; do not fabricate facts; partial must not masquerade as complete; unexecuted verification must not be written as passing.
- Status vocabulary: `current` means source-verified; `design` means proposed implementation; `pending verification` means verification after implementation; `not applicable` carries evidence that the mechanism is missing.

## Requirements review

### Scope

After cross-checking the master table against DSH's current `KNOWN_SESSION_EVENT_TYPES`, the 100-row applicable set is fixed as follows; registry keys absent from the master table — `step/start`, `step/end`, `turn/start`, `session/end-seed`, `schedule/change`, and `session-log-deepseek/delivery-accepted` — are excluded from the denominator.

| Category | Count | Handling |
|---|---:|---|
| Already in DSH, core information complete | 36 | Probe reads associations only; writes no duplicate record |
| Already in DSH, fields need completion | 20 | The probe writes companion facts for observable parts; point fixes add fields for unobservable parts |
| Shared candidate events | 15 | Probe first; point fixes add log-only events for unobservable items |
| DSH has a steer mechanism but no session event | 1 | Point fix writes a log-only event at the manager's acceptance point |
| APUS-only mechanisms | 28 | Not applicable; do not port or fabricate |

The 28 not-applicable items: `model/selection-reset`, `model/automatic-selection`, `reflex/context-cache-anchor`, `reflex/context-projection`, `subagent/supervision-recovery`, `subagent/supervision-steer`, `continuum/*` (#65–70), and `system3/*` (#71–86). These keys have no production mechanism in DSH's current source.

### Principles and decision rules

**Probe first.** Apply the following tests in order; the first match means the probe records the fact:

1. The fact is already a public live event or public Session event that the probe can read.
2. The fact can be obtained by wrapping a public waterfall with prepend/pass-through, and `next()` is called exactly once.
3. The fact can be read through a public service method, such as `workspaceChanges.summary`.

**Point fixes.** Only when all three steps fail, add the smallest missing piece at the fact's owner:

1. If an existing event can safely gain an optional field, add the field in place.
2. Otherwise add a log-only event with `ignorable: true`, and include it in the package's declaration merge and generated registry.
3. A point fix writes facts only: it never re-executes a tool, reruns a summary, makes an extra model request, or changes any return.

**Single producer.** Each `canonicalKey + subject` has exactly one producer in a deployment. The probe's coverage table explicitly marks points that are "read-only association, no canonical fact"; point-fix code writes only the points it owns. AutoEval validates duplicates by the same key; during migration, if a point switches from probe `partial` to a point-fix `complete`, the probe records the stop time in status and the two never coexist.

### Trade-offs

| Option | Result | Decision |
|---|---|---|
| External probe only | No DSH changes, but private facts can only be partial and cannot be complete | Not the only approach |
| Generic observation port | Uniform, but adds an infrastructure layer that every package would depend on in reverse | Not adopted; the user explicitly required point fixes |
| Probe first + point fixes | The probe covers public facts; a small, enumerable set of owner changes can be reviewed independently | Adopted |

Point fixes touch more files than a generic port, but each change serves one recording point, keeping the review surface small and rollback independent; this plan accepts that cost.

### Completion criteria

| Criterion | Pass condition |
|---|---|
| Complete scope | Each of 56/20/15/1/28 has an owner, producer, and verdict; the 28 carry source evidence |
| Honest completeness | Complete points have field sources; partial points have `missing`; not_applicable stays out of the numerator |
| Single production | Each canonicalKey+subject has one record; probe and point fixes never double-write |
| Unchanged business behavior | After filtering the added records, model history, ToolBatchResult, approval/questions, retries, scheduling, and errors match the baseline |
| Failure isolation | A failed probe write or point-fix record does not change business returns; no recursion and no unreleased listener |
| Compatibility | Readers without the new records skip them and model history is unchanged; no Session version bump is required |

## Overall architecture

### Components

| Component | Location | Responsibility |
|---|---|---|
| `dsh-trajectory-probe` | AutoEval: `/home/Project/AutoEval/probes/dsh-trajectory-probe/` | Listen to public events, read public services, wrap waterfalls, maintain association indexes, write `plugin:autoeval/*` |
| Point fixes | DSH fact-owning packages | Add optional fields or log-only events at points the probe cannot see |
| Existing events | Current DSH | Probe reads associations only; the 36 complete events need no duplicate construction |

### Data flow

```text
公开 live/Session 事件 ─┐
public waterfall 包裹  ─┼→ 探针 ProbeRuntime → appendPluginRecord(plugin:autoeval/fact)
公开服务读取          ─┘

探针不可见事实 → 属主在提交点 → 可选字段或 log-only 事件（直接写 Session）
```

Both kinds of records live in the same Session log; the probe does not copy canonical events the owner already writes, and the owner does not write `plugin:autoeval/*`.

### Record contract

Probe fact:

```text
{
  schemaVersion: 1,
  canonicalKey: string,
  subject: { sessionId, turn?, step?, callId?, runId?, retryId?, compactionId?, messageId? },
  at: number,
  coverage: 'complete' | 'partial',
  missing: string[],
  data: JsonValue,
  probe: { instanceId, version }
}
```

Probe status records the instance, version, start and stop times, session trees seen, `droppedRecords`, and the last error. Association prefers real ids; missing ids are never replaced with fabricated values. Duplicate suppression for the same key is performed jointly by the probe index and AutoEval validation.

## External probe design

### Package and mounting

The probe is a standalone Node package whose peer dependencies are only public packages from the current DSH build: `@deepseek-ai/cordis`, `@deepseek-ai/dsh-session`, and the public type packages it actually uses; importing DSH `src/**`, private paths, or `vendor/**` is forbidden.

AutoEval overlay:

```yaml
- insert:
    - id: autoeval-trajectory-probe
      name: /home/Project/AutoEval/probes/dsh-trajectory-probe/lib/index.js
      config:
        enabledFacts: [inbox, request, attempt, catalog, pipeline, subagent-read, workspace]
        includeChildSessions: true
```

`enabledFacts` lists only points the probe produces; points owned by point fixes are omitted to avoid double-writing. The plugin mounts before the first Agent action; facts missed before a late mount are written as `partial`, never backfilled.

### Structure

| Member | Responsibility |
|---|---|
| `ProbeRuntime` | Private to the instance; session/turn/call/run indexes, `droppedRecords`, `instanceId`; cleared on unload |
| `LiveCollector` | Listens to public live/Session events; read-only, deduplicates, completes subjects |
| `WaterfallObserver` | Wraps public waterfalls; passes through, propagates exceptions, records facts only |
| `ServiceReader` | Read-only calls to public services (such as `workspaceChanges.summary`) |
| `RecordWriter` | `appendPluginRecord`; per-record failure containment; `schemaVersion` |
| `StatusWriter` | Start/stop, enabled set, coverage declaration; writes no business facts |

No module-level singleton. The `session/event` callback only updates indexes, never appends, and skips the `plugin:autoeval/` prefix to prevent recursion.

### Transparent observation

For `agent/pre-step`, `agent/request`, `system-prompt/assemble`, `tools/pre-execute`, `tools/execute`, `tools/post-execute`, `approval/request`, and `user-questions/request`, use `{ global: true, prepend: true }`: read public arguments, `await next()` exactly once unchanged, record, and return the original result; record an exception and rethrow the original error. Never modify messages, decisions, signals, tools, answers, retry counts, or order.

Observe `subagent/start`, `subagent/end`, and `agent/assistant-stream` read-only. The probe registers no answerer and never answers approvals or questions on the user's behalf.

### Failure boundaries

- `appendPluginRecord` failures are caught for that call only; `logger.warn` and increment `droppedRecords`; the original return or exception is unchanged.
- No background queue and no retry; if the process crashes, written records remain and AutoEval detects unwritten facts as missing.
- Unload unregisters every listener, clears indexes, and writes a final status; no background task is awaited.
- A record failure never triggers business retry and never rolls back committed state.

## Probe-first coverage

The table lists recording points the probe can cover on its own. "complete" means the probe can obtain all fields for the point's current scenario through public surfaces and writes the fact; "partial" means the probe sees only part, **the probe does not write that point**, keeps only an association index, and the point fix becomes the sole producer; "read-only" means an existing event already carries the point completely.

| Recording point | Probe source | Probe coverage | Handling |
|---|---|---|---|
| #1 agent/inbox/spliced | inbox event + pre-step wrapping | complete (disposition, rejected ids) | Probe writes |
| #2 user/message | event source | complete (synthesizedSource classification) | Probe writes |
| #10 request/header | header event + before/after assemble diff | complete | Probe writes |
| #11 request/context | before/after assemble diff + header | complete | Probe writes |
| #16 assistant/attempt | `agent/assistant-stream` start/end | complete (failure, time band) | Probe writes |
| #21 tool/result-rewrite | wrapping the three tools waterfalls | partial (stage-level visible; individual listeners invisible) | Point fix (probe read-only) |
| #22 tool/pipeline-error | wrapping the three tools waterfalls | partial (stage and error visible; internal project/finalize invisible) | Point fix (probe read-only) |
| #45 user-question/answered | `user-questions/request` wrapping | partial (answer visible; answeredBy invisible) | Point fix (probe read-only) |
| #99 workspace/changes | `workspace/changes` event + `workspaceChanges.summary` | complete (files/stat/digest; truncation keeps total) | Probe writes |
| #7 tool/catalog-resolved | before/after assemble visible set | partial (final set visible; registry/when/executor skipReason invisible) | Point fix for skipReason |
| #8 skill/loaded | tool-skill call and result | partial (name/provider/time; loadedAt/cached invisible) | Point fix |
| #9 turn/pre-step | pre-step wrapping | partial (decision and messages visible; rejectReason invisible) | Point fix for the reason |
| #23 tool/pre-execute-decision | pre-execute wrapping | partial (aggregate gate; individual votes invisible) | Point fix |
| #24 tool/execute-deadline | execute wrapping | partial (elapsed/error; internal timer invisible) | Point fix |
| #26 tool/execution-plan | tool event time band | partial (symptom visible; batch internals invisible) | Point fix |
| #27 spill/spilled | before/after post-execute | partial (final surface visible; threshold invisible) | Point fix |
| #31 tool/provider-selected | deepseek request event | partial (that provider only) | Point fix |
| #32 turn/stopping | turn settlement wrapping | partial (whether to continue; individual votes invisible) | Point fix |
| #44 approval/unavailable | pre-execute wrapping | partial (downstream result; paths before serviceAsk invisible) | Point fix |
| #53 subagent/run-end | subagent start/end | partial (duration/output; steers invisible) | Point fix |
| #17/#18 llm/retry* | request-error wrapping | partial (failure visible; trigger/reuse/generation invisible) | Point fix |
| #20 tool/result provenance | tool/result event | partial (result visible; executor identity invisible) | Point fix |
| #28/#29 ptc dispatch | existing events + time band | partial (calls visible; maxParallel/commit order invisible) | Point fix |
| #33 turn/end | turn close wrapping | partial (outcome visible; blocked reason invisible) | Point fix |
| #34–37 compaction | compaction events | partial (span/summary visible; trigger/retention/generation invisible) | Point fix |
| #42 approval/decided | approval/request wrapping | partial (outcome visible; responder invisible) | Point fix |
| #52 subagent model policy | existing policy events | partial (policy visible; per-instance routing invisible) | Point fix |
| #91 web search | deepseek request event | partial (single provider) | Point fix |
| #95 goal/change | goal events | partial (change visible; blocked rounds invisible) | Point fix |

`#25 tool/retry-started` has no generic tool retry wrapper today and is recorded as not_applicable; the delivery of `#54 subagent/steer` cannot be distinguished from public events and receives a point fix.

## Point fixes

Only points invisible or insufficient to the probe are listed. Each write happens after the package's existing commit point, and failure containment leaves the original business behavior unaffected.

| Recording point | Why the probe is insufficient | DSH point-fix location | Completion method | Depth | After completion |
|---|---|---|---|---|---|
| #7 skipReason | registry restriction, `when`, and executor describe are not public | [core/tools/src/index.ts](../../packages/core/tools/src/index.ts) `resolve`; native/PTC `describe` | Add a `tool/catalog-resolved` log-only event recording per-stage skipReason and the final set digest | L2 | complete |
| #8 skill | cache and real loadedAt are not public | [skill/skill/src/index.ts](../../packages/skill/skill/src/index.ts) `get`/`collect` | Add a `skill/loaded` log-only event; mark missing when the cache is unavailable | L2 | complete/partial |
| #9 rejectReason | `PreStepDecision.reject` has no reason field | [core/agent/src/runtime-types.ts](../../packages/core/agent/src/runtime-types.ts); [agent-loop/src/agent.ts](../../packages/core/agent-loop/src/agent.ts) | Add optional `observation.reason` to reject; the rejecter fills it; agent-loop writes `turn/pre-step` | L1/L2 | complete |
| #17/#18 retry | trigger, assembly reuse, and compaction generation live inside the loop | [llm/llm-retry/src/index.ts](../../packages/llm/llm-retry/src/index.ts); agent-loop request-error | Add optional fields to retry events; the loop supplies assemblyDigest and compactionGeneration | L1 | complete |
| #20 provenance | executor selection and sandbox mode are not public | [core/tools/src/index.ts](../../packages/core/tools/src/index.ts) `selectExecutor`/`execute` | Add a `tool/result-provenance` log-only event; tool definitions may declare pluginOwner/providerId | L2 | complete (declared)/partial (undeclared) |
| #21 individual listener | the waterfall exposes only the aggregate | [core/tools/src/pipeline.ts](../../packages/core/tools/src/pipeline.ts); built-in post/project/finalize listeners | The pipeline writes stage-level rewrite events; built-in listeners self-report listenerId and digest | L2/L3 | complete (built-in)/partial (external) |
| #22 internal stage | project/finalize are not in the waterfall | [core/tools/src/pipeline.ts](../../packages/core/tools/src/pipeline.ts) | Write `tool/pipeline-error` at internal stage boundaries; leave it empty when the thrower does not declare itself | L2 | complete (stage)/partial (thrower) |
| #23 individual vote | other listeners' decisions are invisible | Built-in pre-execute listeners ([hooks-claude-code](../../packages/experimental/hooks-claude-code/src/index.ts), [hooks-codex](../../packages/experimental/hooks-codex/src/index.ts), [auto-review](../../packages/experimental/auto-review/src/index.ts), [workspace-changes](../../packages/deliverables/workspace-changes/src/index.ts), [tool-jobs](../../packages/jobs/tool-jobs/src/index.ts)) and registered guards | Each listener writes `tool/pre-execute-decision` after its own decision; external listeners do not write | L2 | complete (built-in)/partial (external) |
| #24 deadline | timer ownership and signal replacement live inside the wrapper | [guard/timeout-policy/src/index.ts](../../packages/guard/timeout-policy/src/index.ts) | Write `tool/execute-deadline` after arm/fire/restore | L2 | complete |
| #26 execution-plan | batch classification and pooling are internal | [core/tools/src/batch.ts](../../packages/core/tools/src/batch.ts) `runGroup` | Write `tool/execution-plan` after group start/reclassification/commit | L2 | complete |
| #27 spill | threshold and accounting live inside the policy | [spill/spill-policy/src/index.ts](../../packages/spill/spill-policy/src/index.ts) | Write `spill/spilled` at the spill decision | L2 | complete |
| #28/#29 PTC | maxParallel and commit order live in the executor | [core/tool-executor-ptc/src/index.ts](../../packages/core/tool-executor-ptc/src/index.ts) | Extend existing dispatch events with optional fields; write overlap at settlement | L1/L2 | complete |
| #31 provider | web/lsp routing is not public | [web/web/src/index.ts](../../packages/web/web/src/index.ts) `resolveProvider`; [lsp/lsp/src/index.ts](../../packages/lsp/lsp/src/index.ts) `query` | Write `tool/provider-selected` with the real selection and elapsed time; fabricate no fallback | L2 | complete |
| #32 individual vote | serial notifications carry no vote payload | Built-in turn-stopping listeners ([workspace-changes](../../packages/deliverables/workspace-changes/src/index.ts), [hooks-claude-code](../../packages/experimental/hooks-claude-code/src/index.ts), [hooks-codex](../../packages/experimental/hooks-codex/src/index.ts)) | Each writes `turn/stopping`; agent-loop writes the settled summary | L2 | complete (built-in)/partial (external) |
| #33 blocked reason | turn/end keeps only the outcome | [agent-loop/src/agent.ts](../../packages/core/agent-loop/src/agent.ts) | Associate through the observation seq from #9; extend optional fields when necessary | L1 | complete |
| #34–37 compaction | trigger/retention/generation live in the backend | [compaction/compaction-basic/src/index.ts](../../packages/compaction/compaction-basic/src/index.ts) `compactIfNeeded` | Extend existing events with optional fields; callers pass the trigger | L1 | complete |
| #42 responder | the aggregate carries no identity | [interaction/user-approval/src/index.ts](../../packages/interaction/user-approval/src/index.ts) | Built-in answerers self-report responder; the SDK bridge marks `sdk-host`; external stays unknown | L2 | complete (self-reported)/partial |
| #44 unavailable | branches before serviceAsk are invisible | [core/tools/src/pipeline.ts](../../packages/core/tools/src/pipeline.ts) `serviceAsk` | Write `approval/unavailable` on the no-service/no-agent branches; write no Session record without an Agent | L2 | complete |
| #45 answeredBy | only the answer, not the answerer | [interaction/tool-ask-user/src/index.ts](../../packages/interaction/tool-ask-user/src/index.ts); [user-questions](../../packages/interaction/user-questions/src/index.ts) | Write `user-question/answered` on the existing answer path; the responder self-reports | L2 | complete (self-reported)/partial |
| #52 instance routing | the policy event precedes instance creation | [subagent/tool-subagent/src/model-selection-state.ts](../../packages/subagent/tool-subagent/src/model-selection-state.ts) | Additionally write a `subagent/model-selection-observation` log-only event | L2 | complete |
| #53 run-end | no public run-level steers | [subagent/subagent/src/manager.ts](../../packages/subagent/subagent/src/manager.ts); [lifecycle.ts](../../packages/subagent/subagent/src/lifecycle.ts) | The activation observer records start/steers; settlement writes `subagent/run-end` | L2 | complete (local)/partial (remote) |
| #54 steer | delivery cannot be distinguished from events | [subagent/subagent/src/manager.ts](../../packages/subagent/subagent/src/manager.ts) `deliver` | Write `subagent/steer` after successful acceptance, recording delivery/text/messageId | L2 | complete (local) |
| #91 web latency/chain | only single-provider request events | [web/web/src/index.ts](../../packages/web/web/src/index.ts) | Write `web/search-route`; without fallback record the single selection | L2 | complete |
| #95 blocked rounds | goal internal state | [goal/goal/src/index.ts](../../packages/goal/goal/src/index.ts) | Extend `goal/change` with an optional field | L1 | complete |

Shared constraints for point fixes:

1. Write only after the new fact is settled; the original commit happens first.
2. New events are `ignorable: true`, log-only, and non-surface; they never enter model history.
3. New fields add optional properties only; if a persistence tool requires a version bump, stop the direct extension and use a log-only event instead.
4. A failed write only warns and changes neither the original return nor the exception; business work is never retried.
5. External listeners, external answerers, and third-party wrappers stay partial when they are not instrumented; never infer identity from a stack, path, or class name.

## Merged coverage and residual

### Candidates and supplement points

| Number | Recording point | Producer | Final coverage |
|---:|---|---|---|
| 7 | tool/catalog-resolved | Point fix in core/tools + executor | complete |
| 8 | skill/loaded | Point fix in skill | complete (partial when the cache is unavailable) |
| 9 | turn/pre-step | Point fix in agent-loop + rejecter | complete |
| 21 | tool/result-rewrite | Point fix in pipeline + built-in listener | complete (built-in)/partial (external) |
| 22 | tool/pipeline-error | Point fix in pipeline | complete (stage)/partial (thrower) |
| 23 | tool/pre-execute-decision | Point fix in built-in listeners/guards | complete (built-in)/partial (external) |
| 24 | tool/execute-deadline | Point fix in timeout-policy | complete |
| 25 | tool/retry-started | No mechanism | not_applicable |
| 26 | tool/execution-plan | Point fix in batch | complete |
| 27 | spill/spilled | Point fix in spill-policy | complete |
| 31 | tool/provider-selected | Point fix in web/lsp | complete |
| 32 | turn/stopping | Point fix in built-in listeners + agent-loop | complete (built-in)/partial (external) |
| 44 | approval/unavailable | Point fix in pipeline | complete |
| 45 | user-question/answered | Point fix in tool-ask-user/user-questions | complete (self-reported)/partial |
| 53 | subagent/run-end | Point fix in manager/observer | complete (local)/partial (remote) |
| 54 | subagent/steer | Point fix in manager | complete (local) |

### Residual

| Category | Recording points | Reason |
|---|---|---|
| Individual external listener attribution | #21, #23, #32 | They are not instrumented to self-report; Cordis internals are not read |
| Answerer that does not self-report | #42, #45 responder | The service receives only an aggregate |
| Third-party wrapper internals | #24, #25 | No public facts |
| Remote subagent | #53 steers | The provider does not expose them |
| No mechanism | #25 | No generic tool retry today |
| APUS-only | 28 items | DSH has no mechanism |

AutoEval reports must separate complete/partial/not_applicable; partial points do not count toward "100 items complete".

## Compatibility and rollback

1. Probe records go through `appendPluginRecord`, are automatically `ignorable: true`, never enter model history, and need no DSH registry or persistence-change record.
2. New point-fix log-only events enter the declaration merge and generated registry; optional fields follow the same-version rule; when a tool requires a version bump, switch to a log-only event or return to review.
3. Readers without the new records skip them as ignorable; model history is unchanged.
4. Rollback is independent per producer: remove the overlay to stop the probe; revert a point fix to stop that event or field. Written records remain and do not affect business behavior.
5. During migration the same canonicalKey is never double-written: probe status records the disable time and AutoEval validates by key.

## Development conventions

1. The probe depends only on public packages and public APIs; it imports neither `src/**`, private paths, nor `vendor/**`.
2. Point fixes are completed inside the fact-owning package; new types use declaration merging, events default to ignorable, and none enter the surface.
3. Each reporting point writes after the original decision and before the original return; it changes no order, signal, return, or exception.
4. New fields must be existing data or deterministic computation; never re-execute a tool, summary, or model call.
5. A failed write only warns and counts; empty catch is forbidden; name the error and state that business behavior is unaffected.
6. The probe uses no global singleton; the `session/event` callback never appends; unload unregisters listeners.
7. Each package updates its README, JSDoc, subsystem page, snapshots, and TypeScript/Python expected outputs together.
8. Attributable identity must be explicit; never infer it from a path, stack, or class name.

## Environment setup

- Node `>=24.9.0`, pnpm `11.28.5`; the probe uses the same ranges.
- Add no environment variables, services, databases, credentials, or ports.
- The probe's `lib/index.js` is built by AutoEval; DSH builds only the point-fix packages.
- After implementation run: affected package unit tests, `pnpm run build:artifacts`, `pnpm run build:check`, `pnpm run doc-sync`; this plan has not executed them.
- Do not modify DSH profiles, Cordis configuration, or runtime directories; the overlay is maintained only in AutoEval.

## Test method

| Number | Scenario | Independent expectation |
|---|---|---|
| T-01 | Run the same fixture without and with the probe, filtering added records | Model history, ToolBatchResult, approval/questions, retries, scheduling, and errors match |
| T-02 | Probe waterfall normal/exception; append failure; self-recording | `next` runs exactly once; the original exception is unchanged; no recursion |
| T-03 | Point-fix events run with and without the probe | Single production; no duplicate canonicalKey; business behavior unchanged |
| T-04 | native/PTC, catalog skip, batch reclassification | skipReason, executor, and scheduling facts are complete |
| T-05 | pre-execute/turn-stopping with built-in and external listeners mixed | Built-in is complete; external is partial; gate/settlement results are unchanged |
| T-06 | timeout, spill, compaction, retry | Internal fields match real decisions; no re-execution |
| T-07 | Approval/question with and without an answerer | With an answer it is complete; without one the original degrade behavior remains |
| T-08 | subagent normal/error/steer acceptance and rejection | run-end/steer write only after real acceptance; durations match |
| T-09 | web/lsp single choice/unavailable/ambiguous | No fallback is fabricated |
| T-10 | Restore a log containing plugin records without the probe | Model history is unchanged; records remain |
| T-11 | The 28 items and #25 | No false records; report not_applicable |

Reuse the existing Session/Agent/tool/executor/SDK factories; keep business snapshots and added records in separate files; use fixed clocks and ids. Follow the `packages/*/*/src` coverage requirements; negative cases cover missing records, false complete labels, double writes, recursion, and readers that fail to skip. During the planning phase, do not fill in coverage or mutation pass rates.

## Implementation batches

| Batch | Content | Stop condition |
|---|---|---|
| W0 | Scope ledger, baseline fixture, differ, probe skeleton and overlay | Business and added records cannot be separated |
| W1 | Probe live/waterfall/service collection, fact/status, deduplication, recursion guards | Double write, recursion, or business diff |
| W2 | Probe-first points (#1, #2, #10, #11, #16, #99, etc.) and SDK reachability verification | Missing records or business diff |
| W3 | core/tools point fixes (#7, #20–#24, #26, #27) and native/PTC verification | ToolBatchResult or order changes |
| W4 | agent-loop, approval/questions, subagent, compaction, web/lsp, and goal point fixes | Business decisions, exceptions, or order change |
| W5 | Built-in listener/answerer self-reporting, coverage report, residual partial list | A partial point is labeled complete |
| W6 | Real composition, fault injection, probe-free recovery, full diff | Silent partial, double write, or business diff |

W1/W2 go first; W3/W4 may run in parallel when they share no files, with `core/tools` and `agent-loop` integrated by the designated maintainer. Each batch is reviewed and rolled back independently.

## Central open questions

1. Whether to accept the "probe first + point fixes" decision order and the single-producer rule; point fixes are expected to touch about 15 packages — is that acceptable minimal intrusion?
2. Whether to accept the three states complete/partial/not_applicable, keeping external listeners, non-self-reporting answerers, and remote steers partial.
3. Whether to accept built-in listener/answerer self-reporting to complete #23/#32/#42/#45; if rejected, those points stay partial.
4. Whether to confirm that the 28 APUS-only items and #25 are recorded as not_applicable and that DSH will not build System3/Continuum/Reflex or tool retry.
5. Whether to confirm the repository boundary that AutoEval owns the probe and DSH receives only point-fix changes.
6. Whether to accept that plugin records survive format migrations on a best-effort basis and are not a basis for business recovery.

Until confirmed, this document is a reviewable design and does not constitute implementation approval; even if fully approved, DSH only produces facts and records, and Langfuse's final coverage still requires joint acceptance by AutoEval collection and completeness checks.
