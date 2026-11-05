# Agent 轨迹覆盖报告（W5）

[English](agent-trajectory-coverage-report.md) | 中文

## 结论

**下方覆盖计数和逐项判定只是暂定结果，不能证明端到端重建已完成。** 该评估早于当前归因修复，且未验证 AutoEval 是否保留每条观察事件的载荷，包括子会话事件；仍需逐项核对源字段和 AutoEval 的实际消费路径。

此前分类列出 complete 61、partial 10、not_applicable 29；这些数字依据的是来源侧证据，并未验证 AutoEval 端到端保留了每个必需字段，不能用作完成数。

归因和跨会话观察仍有缺口，当前不能声称已完整重建全部适用记录点。

## 判定口径

complete 指该记录点定义的字段在当前场景都有真实来源：探针 fact、现有 Session 事件或定点 log-only 事件，且能定位生产者 file:line。测试存在性单列在证据列；没有直接测试不改变字段来源的判定，但会进入“未验证”清单。

partial 指字段缺失、身份无法归因、实现缺口或找不到生产写入。partial 不因 plan 的“补全后 complete”表述而升级。

not_applicable 指 DSH 当前源码没有该记录点的生产机制。28 项 APUS 专属为 `model/selection-reset`、`model/automatic-selection`、`reflex/context-cache-anchor`、`reflex/context-projection`、`subagent/supervision-recovery`、`subagent/supervision-steer`、`continuum/*`（#65–70）与 `system3/*`（#71–86）；#25 没有通用工具重试包装器。

证据取自当前工作树的 `packages/*/*/src`、`packages/*/*/tests` 与 `known-event-types.ts`，不采用 plan 自述。下表中的路径相对仓库根。

`known-event-types.ts` 当前收录 20 个新增的定点或探针相关事件；`tool/retry-started` 不在其中，按无机制记 not_applicable。

## 主表

| # | 记录点 | 生产者（探针/定点包 + file:line） | 状态 | 关键证据（测试名或缺口） |
|---:|---|---|---|---|
| 1 | `agent/inbox/spliced` | 探针 experimental/trajectory-probe/src/live-collector.ts:105；事件 core/agent-loop/src/inbox.ts:223 | complete | w1-waterfall.spec.ts: inboxSpliced 事实；w2 覆盖 #1 |
| 2 | `user/message` | 探针 experimental/trajectory-probe/src/live-collector.ts:80；事件 core/agent-loop/src/agent.ts:552 | complete | w1-waterfall.spec.ts / w2-pass-through.spec.ts 覆盖同名事实 |
| 3 | `command/run` | interaction/commands/src/index.ts:373 | complete | commands.spec.ts:305 成对记录 |
| 4 | `command/done` | interaction/commands/src/index.ts:380 | complete | commands.spec.ts:305 成对记录 |
| 5 | `system/message` | core/agent-loop/src/agent.ts:545 | complete | 测试 test-support/session-snapshot/tests/normalize.spec.ts:1163,test-support/session-snapshot/tests/normalize.spec.ts:1258 |
| 6 | `developer/message` | core/agent-loop/src/agent.ts:790 | complete | 测试 session/session-format-v3-to-v4/tests/retired-content.spec.ts:81,session/session-format-v3-to-v4/tests/developer-relationships.spec.ts:92 |
| 7 | `tool/catalog-resolved` | core/tools/src/index.ts:344 | complete | activation.spec.ts:44 落地集与 skip 原因 |
| 8 | `skill/loaded` | skill/skill/src/index.ts:901 | complete | 无直接测试；实现已写入 loadedAt/cached |
| 9 | `turn/pre-step` | core/agent-loop/src/agent.ts:356 | complete | 无直接测试；实现含 rejectReason/rejectedUserMessageIds |
| 10 | `request/header` | 探针 experimental/trajectory-probe/src/waterfall-observer.ts:162；事件 core/agent-loop/src/agent.ts:767 | complete | w1-waterfall.spec.ts:44；探针 fact 仅 assemble diff |
| 11 | `request/context` | 探针 experimental/trajectory-probe/src/waterfall-observer.ts:166；事件 core/agent-loop/src/agent.ts:812 | complete | w1-waterfall.spec.ts:44；探针 fact 仅 assemble diff |
| 12 | `model/selection` | core/agent/src/model-selection.ts:114 | complete | 测试 api/session-controller/tests/session-models.host.spec.ts:576,acp/acp/tests/bridge.spec.ts:326 |
| 13 | `model/selection-reset` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 14 | `model/automatic-selection` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 15 | `assistant/message` | core/agent-loop/src/agent.ts:590 | complete | 测试 sdk/client/tests/sdk-client.spec.ts:287,sdk/client/tests/sdk-client.spec.ts:714 |
| 16 | `assistant/attempt` | 探针 experimental/trajectory-probe/src/stream-observer.ts:69；事件 core/agent-loop/src/agent.ts:608 | complete | w2-pass-through.spec.ts:78 committed 带时间带 |
| 17 | `llm/retry` | llm/llm-retry/src/index.ts:246 | complete | retry.spec.ts:238 trigger/assemblyDigest/compactionGeneration |
| 18 | `llm/retry-started` | llm/llm-retry/src/index.ts:246 | complete | retry.spec.ts:238 同组断言 |
| 19 | `tool/call` | core/tools/src/batch.ts:301 | complete | 测试 client/ui-tool/tests/details-models.client.spec.ts:171,client/ui-tool/tests/details-models.client.spec.ts:180 |
| 20 | `tool/result` | core/tools/src/index.ts:475 | partial | attribution.spec.ts:64 未声明 ownership=null |
| 21 | `tool/result-rewrite` | core/tools/src/pipeline.ts | partial | project 和 finalize 记录捕获时的工具定义归属；聚合的 post-execute 监听器仍未归因。 |
| 22 | `tool/pipeline-error` | core/tools/src/pipeline.ts | partial | 已记录多个管道阶段；抛出者归因及结果物化失败与 finalizer 失败的区分仍需验证。 |
| 23 | `tool/pre-execute-decision` | deliverables/workspace-changes/src/index.ts:48 | partial | workspace-changes plugin.spec.ts:257 等内置自报；外部无 |
| 24 | `tool/execute-deadline` | guard/timeout-policy/src/index.ts:69 | complete | execute-deadline.spec.ts:60 armed/fired/restored |
| 25 | `tool/retry-started` | —（无通用工具重试） | not_applicable | 源码无 tool/retry-started；LLM 侧重试见 #17/#18 |
| 26 | `tool/execution-plan` | core/tools/src/batch.ts:83 | complete | execution-plan.spec.ts:44 start/commit/reclassify |
| 27 | `spill/spilled` | spill/spill-policy/src/index.ts:132 | complete | spill-event.spec.ts:66 阈值与保留记账 |
| 28 | `tool/ptc-dispatch` | core/tool-executor-ptc/src/ptc.ts:562 | complete | ptc.spec.ts:822 重叠度与汇总 |
| 29 | `tool/ptc-dispatch-start` | core/tool-executor-ptc/src/ptc.ts:600 | complete | ptc.spec.ts:822 每 dispatch start 事件 |
| 30 | `deliverables/presented` | deliverables/tool-present/src/index.ts:106 | complete | 测试 deliverables/tool-present/tests/present.spec.ts:90,deliverables/tool-present/tests/present.spec.ts:115 |
| 31 | `tool/provider-selected` | web/web/src/index.ts:267；lsp/lsp/src/index.ts:170 | complete | 无直接测试；web/lsp 均写 selectionMode |
| 32 | `turn/stopping` | deliverables/workspace-changes/src/index.ts:104 | partial | contract-regressions.spec.ts:346 汇总；内置 vote 有测试 |
| 33 | `turn/end` | core/agent-loop/src/agent.ts:504 | complete | interception.spec.ts:261 turn/end reason；blocked 原因靠 #9 关联 |
| 34 | `compaction/start` | compaction/compaction-basic/src/region.ts:269 | complete | manual-compaction.spec.ts:273 start/end 顺序 |
| 35 | `compaction/prune` | compaction/compaction-tool-result-pruner/src/index.ts:160 | complete | compaction-tool-result-pruner 测试覆盖 shadow price |
| 36 | `compaction/summary` | compaction/compaction-basic/src/region.ts:561 | complete | manual-compaction.spec.ts:349 summary 记录 |
| 37 | `compaction/end` | compaction/compaction-basic/src/region.ts:300 | complete | manual-compaction.spec.ts:289 end 收束 |
| 38 | `image/offload` | compaction/compaction-image-offload/src/image-offload.ts:44 | complete | 测试 compaction/compaction-image-offload/tests/projection.spec.ts:115,compaction/compaction-image-offload/tests/projection.spec.ts:129 |
| 39 | `reflex/context-cache-anchor` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 40 | `reflex/context-projection` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 41 | `approval/asked` | interaction/user-approval/src/index.ts:252 | complete | 测试 test-support/session-snapshot/tests/suite.spec.ts:1560,interaction/user-approval/tests/projection.spec.ts:110 |
| 42 | `approval/decided` | interaction/user-approval/src/index.ts:259 | partial | approval.spec.ts:90 自报 responder；未自报保持 absent |
| 43 | `approval/policy` | interaction/user-approval/src/index.ts:121 | complete | 测试 interaction/permission-presets/tests/permission-presets.spec.ts:309,interaction/user-approval/tests/approval.spec.ts:419 |
| 44 | `approval/unavailable` | core/tools/src/pipeline.ts:521（`serviceAsk` 的 no-service/no-agent 分支，调用点 :549/:556） | complete | approval-unavailable.spec.ts:36/62/81/97 四例覆盖降级、null askReason、无 Agent 不写、append 失败不改变 deny |
| 45 | `user-question/answered` | interaction/user-questions/src/index.ts:290 | partial | user-questions.spec.ts:956 answered 审计 |
| 46 | `permission/preset` | interaction/permission-presets/src/index.ts:416 | complete | 测试 interaction/permission-presets/tests/permission-presets.spec.ts:324,interaction/permission-presets/tests/projection.spec.ts:187 |
| 47 | `plan/mode` | plan/plan-mode/src/index.ts:446 | complete | 测试 api/session-controller/tests/session-list-blank.host.spec.ts:59,plan/plan-mode/tests/plan-mode.spec.ts:216 |
| 48 | `hook/invoked` | experimental/hook-protocol/src/events.ts:76 | complete | 测试 experimental/hook-protocol/tests/events.spec.ts:11,experimental/hook-protocol/tests/events.spec.ts:16 |
| 49 | `hook/result` | experimental/hook-protocol/src/events.ts:95 | complete | 测试 test-support/session-snapshot/tests/normalize.spec.ts:465,test-support/session-snapshot/tests/normalize.spec.ts:534 |
| 50 | `subagent/catalog` | subagent/subagent/src/catalog.ts:138 | complete | 测试 subagent/subagent/tests/continuation.spec.ts:718,subagent/subagent/tests/working-directory.spec.ts:107 |
| 51 | `subagent/descriptor` | subagent/subagent/src/manager.ts:920 | complete | 测试 subagent/tool-subagent/tests/tool-subagent.spec.ts:743,subagent/tool-subagent/tests/tool-subagent.spec.ts:814 |
| 52 | `subagent/model-selection-policy` | subagent/tool-subagent/src/model-selection-settings.ts:73；observation model-selection-state.ts:108 | complete | model-selection-settings.spec.ts；observation 无直接测试 |
| 53 | `subagent/run-end` | subagent/subagent/src/lifecycle.ts:172 | partial | continuation.spec.ts:3476 run-end；远端 steers 无 |
| 54 | `subagent/steer` | subagent/subagent/src/manager.ts:1503 | complete | 无直接测试；实现只在受理成功后写 |
| 55 | `subagent/supervision-recovery` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 56 | `subagent/supervision-steer` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 57 | `team/member` | experimental/agent-team/src/roster.ts:260 | complete | 测试 experimental/agent-team/tests/projection-events.spec.ts:137,experimental/agent-team/tests/projection-events.spec.ts:142 |
| 58 | `team/message/delivered` | agent-team/src/index.ts:219（目标 inbox） | partial | 当前发送使用目标 Agent 的 inbox，不写这个历史事件；不能把接收与处理完成混为一谈。 |
| 59 | `team/message/queued` | agent-team/src/index.ts:219（目标 inbox） | partial | 当前发送进入目标 Session；AutoEval 是否保留载荷并关联发送仍未验证。 |
| 60 | `team/task` | experimental/agent-team/src/task-board.ts:66 | complete | 测试 experimental/agent-team/tests/projection-events.spec.ts:167,experimental/agent-team/tests/projection-events.spec.ts:172 |
| 61 | `tool-workflow/agent-end` | workflow/tool-workflow/src/index.ts:135 | complete | tool-workflow.spec.ts:177 agent-end 记录 |
| 62 | `tool-workflow/agent-start` | workflow/tool-workflow/src/index.ts:125 | complete | 测试 workflow/tool-workflow/tests/tool-workflow.spec.ts:219 |
| 63 | `tool-workflow/run-end` | workflow/tool-workflow/src/index.ts:146 | complete | 测试 workflow/tool-workflow/tests/tool-workflow.spec.ts:221 |
| 64 | `tool-workflow/run-start` | workflow/tool-workflow/src/index.ts:140 | complete | 测试 workflow/tool-workflow/tests/tool-workflow.spec.ts:195 |
| 65 | `continuum/memory-admission` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 66 | `continuum/memory-decision` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 67 | `continuum/memory-index` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 68 | `continuum/memory-record` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 69 | `continuum/task-binding` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 70 | `continuum/task-operation` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 71 | `system3/completion-review` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 72 | `system3/decision` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 73 | `system3/delegation-alert` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 74 | `system3/delegation-progress` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 75 | `system3/entry-decision` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 76 | `system3/goal-entry` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 77 | `system3/handoff-pack` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 78 | `system3/interjection` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 79 | `system3/judgement` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 80 | `system3/output-fold` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 81 | `system3/process-notice` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 82 | `system3/reflex-evidence` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 83 | `system3/reflex-recovery` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 84 | `system3/reflex-supervision` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 85 | `system3/skill-decision` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 86 | `system3/task-frame` | —（DSH 无机制） | not_applicable | 源码无该 key 声明或生产者 |
| 87 | `job/registered` | jobs/jobs-local/src/index.ts:457 | complete | 测试 workflow/tool-workflow/tests/tool-workflow.spec.ts:598 |
| 88 | `job/settled` | jobs/jobs-local/src/index.ts:458 | complete | 测试 workflow/tool-workflow/tests/tool-workflow.spec.ts:598,jobs/jobs-local/tests/jobs.spec.ts:1590 |
| 89 | `sandbox/mode` | sandbox/sandbox-policy/src/session-mode.ts:54 | complete | 测试 subagent/subagent/tests/continuation-inheritance.spec.ts:285,subagent/subagent/tests/continuation-inheritance.spec.ts:311 |
| 90 | `working-directory/change` | session/working-directory/src/index.ts:143 | complete | 测试 session/working-directory/tests/working-directory.spec.ts:130,session/working-directory/tests/working-directory.spec.ts:234 |
| 91 | `web/deepseek-search-llm-request` | web/web-search-deepseek/src/index.ts:136 | complete | 实现 web-search-deepseek；无直接测试 |
| 92 | `feedback/message-delete` | feedback/message-feedback/src/index.ts:212 | complete | 测试 session/session-telemetry-otel/tests/otel.spec.ts:719,feedback/message-feedback/tests/loader-composition.spec.ts:131 |
| 93 | `feedback/message-put` | feedback/message-feedback/src/index.ts:196 | complete | 测试 session/session-telemetry-otel/tests/otel.spec.ts:645,session/session-telemetry-otel/tests/otel.spec.ts:718 |
| 94 | `feedback/record` | feedback/command-feedback/src/index.ts:60 | complete | 测试 session/session-format-v1-to-v2/tests/codec.spec.ts:263,session/session-format-v3-to-v4/tests/canonical.spec.ts:79 |
| 95 | `goal/change` | goal/goal/src/index.ts:617 | complete | goal.spec.ts:434 blockedRounds 仅 block 变更 |
| 96 | `session/title` | session/session-title/src/index.ts:422 | complete | 测试 session-query/session-log-export/tests/markdown.host.spec.ts:157,api/session-controller/tests/session.client.spec.ts:765 |
| 97 | `session/title-llm-request` | session/session-title-llm/src/index.ts:267 | complete | 测试 session/session-title-llm/tests/llm.spec.ts:226,session/session-title-llm/tests/llm.spec.ts:291 |
| 98 | `todo/write` | todo/tool-todo/src/index.ts:200 | complete | 测试 experimental/webworker-runtime/tests/vfs-example-fixture.spec.ts:188,todo/tool-todo/tests/tool-todo.spec.ts:72 |
| 99 | `workspace/changes` | 探针 experimental/trajectory-probe/src/service-reader.ts:68；事件 deliverables/workspace-changes/src/recorder.ts:351 | complete | workspace-changes plugin.spec.ts；probe service-reader 测试 |
| 100 | `agent-preset/selected` | api/session-controller/src/agent.ts:421 | complete | continuation-presets.spec.ts:194 预设选择 |

## 残余 partial 清单

| 类别 | 记录点 | 现状 | 原因 |
|---|---|---|---|
| 外部监听器个体归因 | #21 tool/result-rewrite | partial | project 和 finalize 使用捕获时的工具定义归属；post-execute 的聚合决定不能标识具体监听器。 |
| 外部监听器个体归因 | #23 tool/pre-execute-decision | partial | `workspace-changes`、`auto-review`、`hooks-claude-code`、`hooks-codex`、`tool-jobs` 五个内置 listener 自报 `listenerId`；其他外部 listener 不写，不能归因。 |
| 外部监听器个体归因 | #32 turn/stopping | partial | 内置 turn-stopping listener 各写 vote，agent-loop 写 settled 汇总；外部 listener 不写 vote。 |
| 未自报 answerer | #42 approval/decided | partial | `responder` 由回答 listener 自报；未自报、fail-closed 或 never 策略时 `responder` 缺失。 |
| 未自报 answerer | #45 user-question/answered | partial | 答案与 `responder` 由 user-questions 路径记录；未自报 answerer 的应答者身份仍缺失。 |
| 第三方包装器内部 | #24 tool/execute-deadline | complete | timeout-policy 在 arm/fire/restore 后写事件，预算、耗时与 timer 结果可见；不列入 partial。 |
| 无机制 | #25 tool/retry-started | not_applicable | DSH 当前没有通用工具重试包装器；LLM 侧重试由 #17/#18 承载。 |
| 远端 subagent | #53 subagent/run-end | partial | 本地 run-end 与 steers 由 lifecycle observer 记录；远端 provider 不暴露 steers。 |
| APUS 专属 | #13、#14、#39、#40、#55、#56、#65–#86 | not_applicable | 当前源码没有这些 key 的声明或生产者；不移植、不伪造。 |
| 计划外字段缺口 | #20 tool/result attribution | partial | `tool/result-attribution` 已记录选中的 executor 与逐 call ownership，但未声明 `pluginOwner`/`providerId` 的工具和未声明 `executorId` 的 executor 记录 null，只能 partial。 |
| 计划外字段缺口 | #22 tool/pipeline-error | partial | 工具定义自有的阶段可记录归属；匿名监听器及结果物化失败的归因仍待验证。 |
| 消息关联 | #58 team/message/delivered、#59 team/message/queued | partial | 新发送进入目标 Session 的 inbox，不写这两个历史事件；仍需验证 AutoEval 的跨会话载荷保留和关联。 |

### partial 记录点的字段补全

上表列出的字段不等于归因和重建已经完整：监听器身份、事件载荷的消费以及跨会话关联仍需验证。

| 记录点 | 补充字段 | 为何可行 |
|---|---|---|
| #7 `tool/catalog-exposed` | `schemaDigests`，逐个暴露 schema 的摘要 | executor 的 `describe()` 返回值在记录点就在手边 |
| #21 `tool/result-rewrite` | 每阶段 `beforeDigest`、`replacedField` | 改写前后的内容在该处都是局部变量 |
| #22 `tool/pipeline-error` | 阶段联合从 2 个扩到 5 个（`pre-execute`、`execute-wrapper`、`project`、`post-execute`、`finalize`） | 每个边界本来就有自己的 catch，现在记录而不只是重新抛出 |
| #24 `tool/execute-deadline` | `elapsedMs`、`abortSource`、`signalReplaced` | 包装器掌握计时器与信号替换 |
| #26 `tool/execution-plan` | `exclusiveBarrier` | 调度器在重分类处即可观察到屏障 |
| #27 `spill/spilled` | `originalDigest`、`previewDigest` | 替换提交时两份内容都在 |

以下要求仍未验证：`turn/stopping` 的 `extraStepsRun` 需要关联 turn 结束结果；答案对应的问题原文需要核实持久化来源及配对路径；单个监听器无法看到 `tool/pre-execute-decision` 的 `orderIndex` 和 `shortCircuited`。

## 未验证与环境受限

环境已安装 C 编译器，先前一次 `build:artifacts` 已通过；此后源码继续变化，最终验收前需要重新构建并检查。

探针侧字段读取仍需确认：#10 `request/header` 与 #11 `request/context` 的探针 fact 只写 assemble 前后的 section/context 名称增量和名称快照（`experimental/trajectory-probe/src/waterfall-observer.ts:162`、`:166`），不包含 request header 的超参数、tools schema 与路由元数据；这些字段仍来自 agent-loop 的 `request/header`/`request/context` 事件。若 AutoEval 只读探针 fact，这两点会缺字段，需要 AutoEval 侧联表或探针补读。

无直接测试的 complete 点：#8 `skill/loaded`、#9 `turn/pre-step`、#31 `tool/provider-selected`、#54 `subagent/steer`、#91 `web/deepseek-search-llm-request` 的新增字段；#52 的 `subagent/model-selection-observation` 也没有直接测试。它们有生产者 file:line，但缺少行为断言，不能据此声称已验证。

对于 #21，管道可以归因工具定义自有的回调，但内置和外部 post-execute 监听器的个体归因仍需证据。

#58/#59 需要 owner 确认：如果 team 消息的生产者在本仓之外，或已迁移到 `subagent/steer`，应更新总表归类；当前工作树只能判 partial。

多数“已持久化”记录的测试证据来自 Session 格式、投影或客户端测试，只证明事件可读/可投影，不证明轨迹字段在真实 agent 运行中被写入；本报告在证据列如实标注测试文件，未把格式测试当作行为测试。

探针伴生事实与现有事件同键：#1、#2、#10、#11、#16、#99 的探针 fact 使用与现有 Session 事件相同的 `canonicalKey`。字段本身可由两者之一提供，但 AutoEval 若按 key 直接计数，会把同一记录点算成两份；需要 AutoEval 按记录来源去重，或在合同中明确“伴生事实”只补字段、不单独成行。

## 校验记录

`pnpm run verify-md-wrap`：通过，2321 个文件无硬换行段落。

`pnpm run verify-md-links`：通过，2273 个文件全部相对链接与锚点可解析；trajectory-probe README 原有的两处失效链接已修复（AutoEval 外链改为纯文本，plan 链接改为 `../../../docs/loggs/...`），定向复查两个文件均返回空违规列表。

`pnpm exec vitest run scripts/doc-standard.spec.ts -t "keeps every package README on the summary"`：通过；`-t "maps package README kinds to their documentation standards"`：通过。trajectory-probe README 已补 frontmatter、Summary、Table of Contents 与 Dev Note。

`pnpm exec vitest run packages/core/tools/tests/approval-unavailable.spec.ts`：4 例全部通过，覆盖 no-service 降级、null askReason、无 Agent 不写、append 失败不改变 deny。

`pnpm run verify-translation-pairing docs/loggs/agent-trajectory-coverage-report.md`：重新记录分节哈希后通过；两边的行数、标题结构与表格列数一致。

`pnpm run verify-translation-pairing packages/experimental/trajectory-probe/README.md`：通过；该 README 连同 `README.zh.md` 与 `README.i18n.yaml` 配对一起存在。
