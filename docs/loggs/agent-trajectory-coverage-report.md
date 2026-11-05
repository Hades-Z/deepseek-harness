# Agent Trajectory Coverage Report (W5)

English | [中文](agent-trajectory-coverage-report.zh.md)

## Conclusion

**The coverage counts and row verdicts below are provisional, not proof of end-to-end reconstruction.** The assessment predates the current attribution fixes and did not verify that AutoEval retains every observed event payload, including child-session events. Reconciliation against the source fields and the actual AutoEval consumption path is still required.

The earlier classification listed 61 complete, 10 partial, and 29 not applicable. Those counts assessed source-side evidence, not AutoEval's end-to-end retention of every required field; they must not be used as a completion count.

Several attribution and cross-session observation gaps remain; the work cannot currently claim complete reconstruction of the applicable recording points.

## Verdict rules

Complete means every field defined by the recording point has a real source in the current scenario: a probe fact, an existing Session event, or a point-fix log-only event, with the producer's file:line locatable. Test existence is listed separately in the evidence column; the absence of a direct test does not change the field-source verdict, but the point enters the "unverified" list.

Partial means fields are missing, identity cannot be attributed, an implementation gap exists, or no production write can be found. Partial is not promoted by the plan's "complete after completion" wording.

Not_applicable means DSH's current source has no production mechanism for the recording point. The 28 APUS-only items are `model/selection-reset`, `model/automatic-selection`, `reflex/context-cache-anchor`, `reflex/context-projection`, `subagent/supervision-recovery`, `subagent/supervision-steer`, `continuum/*` (#65–70), and `system3/*` (#71–86); #25 has no generic tool retry wrapper.

Evidence comes from `packages/*/*/src`, `packages/*/*/tests`, and `known-event-types.ts` in the current worktree, not from the plan's own statements. Paths in the tables below are relative to the repository root.

`known-event-types.ts` currently contains 20 added point-fix or probe-related events; `tool/retry-started` is not among them and is recorded as not_applicable for lack of a mechanism.

## Main table

| # | Recording point | Producer (probe/point-fix package + file:line) | Status | Key evidence (test name or gap) |
|---:|---|---|---|---|
| 1 | `agent/inbox/spliced` | Probe experimental/trajectory-probe/src/live-collector.ts:105; event core/agent-loop/src/inbox.ts:223 | complete | w1-waterfall.spec.ts: inboxSpliced fact; w2 covers #1 |
| 2 | `user/message` | Probe experimental/trajectory-probe/src/live-collector.ts:80; event core/agent-loop/src/agent.ts:552 | complete | w1-waterfall.spec.ts / w2-pass-through.spec.ts cover the same-named fact |
| 3 | `command/run` | interaction/commands/src/index.ts:373 | complete | commands.spec.ts:305 paired records |
| 4 | `command/done` | interaction/commands/src/index.ts:380 | complete | commands.spec.ts:305 paired records |
| 5 | `system/message` | core/agent-loop/src/agent.ts:545 | complete | Tests test-support/session-snapshot/tests/normalize.spec.ts:1163,test-support/session-snapshot/tests/normalize.spec.ts:1258 |
| 6 | `developer/message` | core/agent-loop/src/agent.ts:790 | complete | Tests session/session-format-v3-to-v4/tests/retired-content.spec.ts:81,session/session-format-v3-to-v4/tests/developer-relationships.spec.ts:92 |
| 7 | `tool/catalog-resolved` | core/tools/src/index.ts:344 | complete | activation.spec.ts:44 landed set and skip reasons |
| 8 | `skill/loaded` | skill/skill/src/index.ts:901 | complete | No direct test; implementation writes loadedAt/cached |
| 9 | `turn/pre-step` | core/agent-loop/src/agent.ts:356 | complete | No direct test; implementation includes rejectReason/rejectedUserMessageIds |
| 10 | `request/header` | Probe experimental/trajectory-probe/src/waterfall-observer.ts:162; event core/agent-loop/src/agent.ts:767 | complete | w1-waterfall.spec.ts:44; probe fact is the assemble diff only |
| 11 | `request/context` | Probe experimental/trajectory-probe/src/waterfall-observer.ts:166; event core/agent-loop/src/agent.ts:812 | complete | w1-waterfall.spec.ts:44; probe fact is the assemble diff only |
| 12 | `model/selection` | core/agent/src/model-selection.ts:114 | complete | Tests api/session-controller/tests/session-models.host.spec.ts:576,acp/acp/tests/bridge.spec.ts:326 |
| 13 | `model/selection-reset` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 14 | `model/automatic-selection` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 15 | `assistant/message` | core/agent-loop/src/agent.ts:590 | complete | Tests sdk/client/tests/sdk-client.spec.ts:287,sdk/client/tests/sdk-client.spec.ts:714 |
| 16 | `assistant/attempt` | Probe experimental/trajectory-probe/src/stream-observer.ts:69; event core/agent-loop/src/agent.ts:608 | complete | w2-pass-through.spec.ts:78 committed carries the time band |
| 17 | `llm/retry` | llm/llm-retry/src/index.ts:246 | complete | retry.spec.ts:238 trigger/assemblyDigest/compactionGeneration |
| 18 | `llm/retry-started` | llm/llm-retry/src/index.ts:246 | complete | retry.spec.ts:238 same assertion group |
| 19 | `tool/call` | core/tools/src/batch.ts:301 | complete | Tests client/ui-tool/tests/details-models.client.spec.ts:171,client/ui-tool/tests/details-models.client.spec.ts:180 |
| 20 | `tool/result` | core/tools/src/index.ts:475 | partial | attribution.spec.ts:64 undeclared ownership=null |
| 21 | `tool/result-rewrite` | core/tools/src/pipeline.ts | partial | Project and finalize record the captured definition owner; the aggregate post-execute listener remains unattributed. |
| 22 | `tool/pipeline-error` | core/tools/src/pipeline.ts | partial | Several pipeline stages are recorded; thrower attribution and the distinction between materialization and finalizer failures need further verification. |
| 23 | `tool/pre-execute-decision` | deliverables/workspace-changes/src/index.ts:48 | partial | workspace-changes plugin.spec.ts:257 and other built-in self-reports; none external |
| 24 | `tool/execute-deadline` | guard/timeout-policy/src/index.ts:69 | complete | execute-deadline.spec.ts:60 armed/fired/restored |
| 25 | `tool/retry-started` | — (no generic tool retry) | not_applicable | No tool/retry-started in source; LLM-side retry is covered by #17/#18 |
| 26 | `tool/execution-plan` | core/tools/src/batch.ts:83 | complete | execution-plan.spec.ts:44 start/commit/reclassify |
| 27 | `spill/spilled` | spill/spill-policy/src/index.ts:132 | complete | spill-event.spec.ts:66 threshold and retention accounting |
| 28 | `tool/ptc-dispatch` | core/tool-executor-ptc/src/ptc.ts:562 | complete | ptc.spec.ts:822 overlap and summary |
| 29 | `tool/ptc-dispatch-start` | core/tool-executor-ptc/src/ptc.ts:600 | complete | ptc.spec.ts:822 a start event per dispatch |
| 30 | `deliverables/presented` | deliverables/tool-present/src/index.ts:106 | complete | Tests deliverables/tool-present/tests/present.spec.ts:90,deliverables/tool-present/tests/present.spec.ts:115 |
| 31 | `tool/provider-selected` | web/web/src/index.ts:267; lsp/lsp/src/index.ts:170 | complete | No direct test; both web and lsp write selectionMode |
| 32 | `turn/stopping` | deliverables/workspace-changes/src/index.ts:104 | partial | contract-regressions.spec.ts:346 summary; built-in votes are tested |
| 33 | `turn/end` | core/agent-loop/src/agent.ts:504 | complete | interception.spec.ts:261 turn/end reason; the blocked reason relies on the #9 association |
| 34 | `compaction/start` | compaction/compaction-basic/src/region.ts:269 | complete | manual-compaction.spec.ts:273 start/end order |
| 35 | `compaction/prune` | compaction/compaction-tool-result-pruner/src/index.ts:160 | complete | compaction-tool-result-pruner tests cover shadow price |
| 36 | `compaction/summary` | compaction/compaction-basic/src/region.ts:561 | complete | manual-compaction.spec.ts:349 summary record |
| 37 | `compaction/end` | compaction/compaction-basic/src/region.ts:300 | complete | manual-compaction.spec.ts:289 end settlement |
| 38 | `image/offload` | compaction/compaction-image-offload/src/image-offload.ts:44 | complete | Tests compaction/compaction-image-offload/tests/projection.spec.ts:115,compaction/compaction-image-offload/tests/projection.spec.ts:129 |
| 39 | `reflex/context-cache-anchor` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 40 | `reflex/context-projection` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 41 | `approval/asked` | interaction/user-approval/src/index.ts:252 | complete | Tests test-support/session-snapshot/tests/suite.spec.ts:1560,interaction/user-approval/tests/projection.spec.ts:110 |
| 42 | `approval/decided` | interaction/user-approval/src/index.ts:259 | partial | approval.spec.ts:90 self-reported responder; stays absent when not self-reported |
| 43 | `approval/policy` | interaction/user-approval/src/index.ts:121 | complete | Tests interaction/permission-presets/tests/permission-presets.spec.ts:309,interaction/user-approval/tests/approval.spec.ts:419 |
| 44 | `approval/unavailable` | core/tools/src/pipeline.ts:521 (`serviceAsk` no-service/no-agent branches, call sites :549/:556) | complete | approval-unavailable.spec.ts:36/62/81/97 cover four cases: degraded, null askReason, no write without an Agent, append failure leaves deny unchanged |
| 45 | `user-question/answered` | interaction/user-questions/src/index.ts:290 | partial | user-questions.spec.ts:956 answered audit |
| 46 | `permission/preset` | interaction/permission-presets/src/index.ts:416 | complete | Tests interaction/permission-presets/tests/permission-presets.spec.ts:324,interaction/permission-presets/tests/projection.spec.ts:187 |
| 47 | `plan/mode` | plan/plan-mode/src/index.ts:446 | complete | Tests api/session-controller/tests/session-list-blank.host.spec.ts:59,plan/plan-mode/tests/plan-mode.spec.ts:216 |
| 48 | `hook/invoked` | experimental/hook-protocol/src/events.ts:76 | complete | Tests experimental/hook-protocol/tests/events.spec.ts:11,experimental/hook-protocol/tests/events.spec.ts:16 |
| 49 | `hook/result` | experimental/hook-protocol/src/events.ts:95 | complete | Tests test-support/session-snapshot/tests/normalize.spec.ts:465,test-support/session-snapshot/tests/normalize.spec.ts:534 |
| 50 | `subagent/catalog` | subagent/subagent/src/catalog.ts:138 | complete | Tests subagent/subagent/tests/continuation.spec.ts:718,subagent/subagent/tests/working-directory.spec.ts:107 |
| 51 | `subagent/descriptor` | subagent/subagent/src/manager.ts:920 | complete | Tests subagent/tool-subagent/tests/tool-subagent.spec.ts:743,subagent/tool-subagent/tests/tool-subagent.spec.ts:814 |
| 52 | `subagent/model-selection-policy` | subagent/tool-subagent/src/model-selection-settings.ts:73; observation model-selection-state.ts:108 | complete | model-selection-settings.spec.ts; observation has no direct test |
| 53 | `subagent/run-end` | subagent/subagent/src/lifecycle.ts:172 | partial | continuation.spec.ts:3476 run-end; no remote steers |
| 54 | `subagent/steer` | subagent/subagent/src/manager.ts:1503 | complete | No direct test; implementation writes only after successful acceptance |
| 55 | `subagent/supervision-recovery` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 56 | `subagent/supervision-steer` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 57 | `team/member` | experimental/agent-team/src/roster.ts:260 | complete | Tests experimental/agent-team/tests/projection-events.spec.ts:137,experimental/agent-team/tests/projection-events.spec.ts:142 |
| 58 | `team/message/delivered` | agent-team/src/index.ts:219 (target inbox) | partial | Current sends use the target Agent's inbox, not this historical event; acceptance and processing must not be conflated. |
| 59 | `team/message/queued` | agent-team/src/index.ts:219 (target inbox) | partial | Current sends enter the target Session; whether AutoEval retains its payload and correlates it to the send remains unverified. |
| 60 | `team/task` | experimental/agent-team/src/task-board.ts:66 | complete | Tests experimental/agent-team/tests/projection-events.spec.ts:167,experimental/agent-team/tests/projection-events.spec.ts:172 |
| 61 | `tool-workflow/agent-end` | workflow/tool-workflow/src/index.ts:135 | complete | tool-workflow.spec.ts:177 agent-end record |
| 62 | `tool-workflow/agent-start` | workflow/tool-workflow/src/index.ts:125 | complete | Tests workflow/tool-workflow/tests/tool-workflow.spec.ts:219 |
| 63 | `tool-workflow/run-end` | workflow/tool-workflow/src/index.ts:146 | complete | Tests workflow/tool-workflow/tests/tool-workflow.spec.ts:221 |
| 64 | `tool-workflow/run-start` | workflow/tool-workflow/src/index.ts:140 | complete | Tests workflow/tool-workflow/tests/tool-workflow.spec.ts:195 |
| 65 | `continuum/memory-admission` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 66 | `continuum/memory-decision` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 67 | `continuum/memory-index` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 68 | `continuum/memory-record` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 69 | `continuum/task-binding` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 70 | `continuum/task-operation` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 71 | `system3/completion-review` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 72 | `system3/decision` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 73 | `system3/delegation-alert` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 74 | `system3/delegation-progress` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 75 | `system3/entry-decision` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 76 | `system3/goal-entry` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 77 | `system3/handoff-pack` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 78 | `system3/interjection` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 79 | `system3/judgement` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 80 | `system3/output-fold` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 81 | `system3/process-notice` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 82 | `system3/reflex-evidence` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 83 | `system3/reflex-recovery` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 84 | `system3/reflex-supervision` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 85 | `system3/skill-decision` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 86 | `system3/task-frame` | — (no DSH mechanism) | not_applicable | No declaration or producer for this key in source |
| 87 | `job/registered` | jobs/jobs-local/src/index.ts:457 | complete | Tests workflow/tool-workflow/tests/tool-workflow.spec.ts:598 |
| 88 | `job/settled` | jobs/jobs-local/src/index.ts:458 | complete | Tests workflow/tool-workflow/tests/tool-workflow.spec.ts:598,jobs/jobs-local/tests/jobs.spec.ts:1590 |
| 89 | `sandbox/mode` | sandbox/sandbox-policy/src/session-mode.ts:54 | complete | Tests subagent/subagent/tests/continuation-inheritance.spec.ts:285,subagent/subagent/tests/continuation-inheritance.spec.ts:311 |
| 90 | `working-directory/change` | session/working-directory/src/index.ts:143 | complete | Tests session/working-directory/tests/working-directory.spec.ts:130,session/working-directory/tests/working-directory.spec.ts:234 |
| 91 | `web/deepseek-search-llm-request` | web/web-search-deepseek/src/index.ts:136 | complete | Implements web-search-deepseek; no direct test |
| 92 | `feedback/message-delete` | feedback/message-feedback/src/index.ts:212 | complete | Tests session/session-telemetry-otel/tests/otel.spec.ts:719,feedback/message-feedback/tests/loader-composition.spec.ts:131 |
| 93 | `feedback/message-put` | feedback/message-feedback/src/index.ts:196 | complete | Tests session/session-telemetry-otel/tests/otel.spec.ts:645,session/session-telemetry-otel/tests/otel.spec.ts:718 |
| 94 | `feedback/record` | feedback/command-feedback/src/index.ts:60 | complete | Tests session/session-format-v1-to-v2/tests/codec.spec.ts:263,session/session-format-v3-to-v4/tests/canonical.spec.ts:79 |
| 95 | `goal/change` | goal/goal/src/index.ts:617 | complete | goal.spec.ts:434 blockedRounds only on block changes |
| 96 | `session/title` | session/session-title/src/index.ts:422 | complete | Tests session-query/session-log-export/tests/markdown.host.spec.ts:157,api/session-controller/tests/session.client.spec.ts:765 |
| 97 | `session/title-llm-request` | session/session-title-llm/src/index.ts:267 | complete | Tests session/session-title-llm/tests/llm.spec.ts:226,session/session-title-llm/tests/llm.spec.ts:291 |
| 98 | `todo/write` | todo/tool-todo/src/index.ts:200 | complete | Tests experimental/webworker-runtime/tests/vfs-example-fixture.spec.ts:188,todo/tool-todo/tests/tool-todo.spec.ts:72 |
| 99 | `workspace/changes` | Probe experimental/trajectory-probe/src/service-reader.ts:68; event deliverables/workspace-changes/src/recorder.ts:351 | complete | workspace-changes plugin.spec.ts; probe service-reader test |
| 100 | `agent-preset/selected` | api/session-controller/src/agent.ts:421 | complete | continuation-presets.spec.ts:194 preset selection |

## Residual partial list

| Category | Recording point | Current state | Reason |
|---|---|---|---|
| Individual external listener attribution | #21 tool/result-rewrite | partial | Project and finalize use the captured tool definition owner; the post-execute aggregate does not identify individual listeners. |
| Individual external listener attribution | #23 tool/pre-execute-decision | partial | Five built-in listeners — `workspace-changes`, `auto-review`, `hooks-claude-code`, `hooks-codex`, and `tool-jobs` — self-report `listenerId`; other external listeners do not write, so they cannot be attributed. |
| Individual external listener attribution | #32 turn/stopping | partial | Built-in turn-stopping listeners each write a vote, and agent-loop writes the settled summary; external listeners write no vote. |
| Answerer that does not self-report | #42 approval/decided | partial | `responder` is self-reported by the answering listener; it is missing when no listener self-reports, under fail-closed, or under the `never` policy. |
| Answerer that does not self-report | #45 user-question/answered | partial | The answer and `responder` are recorded by the user-questions path; the identity of an answerer that does not self-report is still missing. |
| Third-party wrapper internals | #24 tool/execute-deadline | complete | timeout-policy writes the event after arm/fire/restore; the budget, elapsed time, and timer outcome are visible; not listed as partial. |
| No mechanism | #25 tool/retry-started | not_applicable | DSH currently has no generic tool retry wrapper; LLM-side retry is carried by #17/#18. |
| Remote subagent | #53 subagent/run-end | partial | The local run-end and steers are recorded by the lifecycle observer; remote providers do not expose steers. |
| APUS-only | #13, #14, #39, #40, #55, #56, #65–#86 | not_applicable | Current source declares or produces none of these keys; do not port or fabricate. |
| Unplanned field gap | #20 tool/result attribution | partial | `tool/result-attribution` records the selected executor and per-call ownership, but tools that do not declare `pluginOwner`/`providerId` and executors that do not declare `executorId` record null and can only be partial. |
| Unplanned field gap | #22 tool/pipeline-error | partial | Definition-owned stages can name an owner; attribution of anonymous listeners and materialization failures remains unverified. |
| Message correlation | #58 team/message/delivered, #59 team/message/queued | partial | New sends enter the target Session's inbox rather than these historical events; AutoEval's cross-session payload retention and correlation need verification. |

### Field-completeness pass on the partial points

The fields listed above do not establish complete attribution or reconstruction: listener identities, event payload consumption, and cross-session correlation still need verification.

| Point | Added | Why it was feasible |
|---|---|---|
| #7 `tool/catalog-exposed` | `schemaDigests` — one digest per exposed schema | The executor's `describe()` return value is in hand at the recording point |
| #21 `tool/result-rewrite` | `beforeDigest`, `replacedField` per stage | Both the incoming and replacement content are local variables there |
| #22 `tool/pipeline-error` | stage union widened from 2 to 5 (`pre-execute`, `execute-wrapper`, `project`, `post-execute`, `finalize`) | Each boundary already had its own catch; they now record rather than only rethrow |
| #24 `tool/execute-deadline` | `elapsedMs`, `abortSource`, `signalReplaced` | The wrapper owns the timer and the signal swap |
| #26 `tool/execution-plan` | `exclusiveBarrier` | The scheduler observes the barrier at reclassification |
| #27 `spill/spilled` | `originalDigest`, `previewDigest` | Both content lists exist when the replacement is committed |

The following requirements remain unverified: `turn/stopping`'s `extraStepsRun` requires turn-end correlation; an answer's question text requires a verified durable source and join; and `tool/pre-execute-decision`'s `orderIndex` and `shortCircuited` are not visible to an individual listener.

## Unverified and environment limitations

A C compiler was installed and an earlier `build:artifacts` run passed. Subsequent source changes require a fresh build and checks before final acceptance.

Probe-side field reads still need confirmation: the probe facts for #10 `request/header` and #11 `request/context` write only the section/context name deltas and name snapshots before and after assemble (`experimental/trajectory-probe/src/waterfall-observer.ts:162`, `:166`), not the request header hyperparameters, tool schemas, or routing metadata; those fields still come from agent-loop's `request/header`/`request/context` events. If AutoEval reads only probe facts, these two points will lack fields and need an AutoEval-side join or an additional probe read.

Complete points without direct tests: the added fields of #8 `skill/loaded`, #9 `turn/pre-step`, #31 `tool/provider-selected`, #54 `subagent/steer`, and #91 `web/deepseek-search-llm-request`; #52's `subagent/model-selection-observation` also has no direct test. They have producer file:line locations but lack behavior assertions, so verification cannot be claimed from them.

For #21, the pipeline can attribute definition-owned callbacks, but built-in and external post-execute listeners still require individual attribution evidence.

#58/#59 need owner confirmation: if the team message producer lives outside this repository or has migrated to `subagent/steer`, the master table classification should be updated; the current worktree can only judge partial.

Most test evidence for "already persisted" records comes from Session format, projection, or client tests, which only prove the event is readable/projectable, not that trajectory fields are written during a real agent run; the evidence column reports the test files as they are and does not treat format tests as behavior tests.

Probe companion facts share keys with existing events: the probe facts for #1, #2, #10, #11, #16, and #99 use the same `canonicalKey` as the existing Session events. Either side can supply the fields, but if AutoEval counts directly by key it will count the same recording point twice; AutoEval must deduplicate by record source, or the contract must state that "companion facts" only supplement fields and never form separate rows.

## Verification record

`pnpm run verify-md-wrap`: passed; 2321 files with no hard-wrapped paragraphs.

`pnpm run verify-md-links`: passed; all relative links and anchors in 2273 files resolve; the two broken links in the trajectory-probe README were fixed (the external AutoEval link became plain text, and the plan link became `../../../docs/loggs/...`), and targeted re-checks of both files returned empty violation lists.

`pnpm exec vitest run scripts/doc-standard.spec.ts -t "keeps every package README on the summary"`: passed; `-t "maps package README kinds to their documentation standards"`: passed. The trajectory-probe README received frontmatter, Summary, Table of Contents, and Dev Note.

`pnpm exec vitest run packages/core/tools/tests/approval-unavailable.spec.ts`: all 4 cases passed, covering no-service degradation, null askReason, no write without an Agent, and append failure leaving deny unchanged.

`pnpm run verify-translation-pairing docs/loggs/agent-trajectory-coverage-report.md`: passed after re-recording the section hashes; both sides have the same line count, heading structure, and table columns.

`pnpm run verify-translation-pairing packages/experimental/trajectory-probe/README.md`: passed; the README ships with its `README.zh.md` and `README.i18n.yaml` pair.
