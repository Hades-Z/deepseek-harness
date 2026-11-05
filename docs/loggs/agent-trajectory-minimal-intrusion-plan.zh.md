# Deepseek Harness Agent 轨迹埋点：探针优先＋定点补全技术方案

[English](agent-trajectory-minimal-intrusion-plan.md) | 中文

本方案按“探针优先＋定点补全”组织，不设并行轨道。默认由 AutoEval 持有的外挂探针插件记录；只有探针通过公开事件、公开服务或公开 waterfall 包裹都拿不到的事实，才在事实属主处做定点补全。每个记录点只有一个事实生产者，探针与定点代码不写同一事实的两份记录。

“完整记录”按记录点定义：当前适用场景要求的字段都有真实来源，覆盖为 `complete` 且 `missing=[]`。外部监听器、未自报身份的 answerer、第三方包装器内部事实只能记 `partial` 并列出缺失；没有对应机制的点记 `not_applicable`。partial 不计入完整分子，不用推测补齐。

本文是设计稿，未评审、未实施、未执行测试。方案只覆盖 DSH 侧事实产生与探针落盘；AutoEval 的子会话收集、idle 后补读和 Langfuse 写入不在本次范围。

## 执行约定

- 版本与日期：v0.3，2026-10-28。
- 基线：`/home/Project/Harness/Deepseek-Harness`，发布标签 `v0.2.2-alpha.2`。
- 业务索引：[Agent 轨迹追记持久化事件总表](../../../AutoEval/docs/logging-plan/agent-trajectory-persistence-events.md)。
- 需求来源：用户要求按“探针优先＋定点补全”重写为一份完整方案，不保留并行轨道，并优先用外挂探针实现完整埋点。
- 读者与用途：供 DSH 与 AutoEval 维护者评审记录合同、定点改动和验收；不授权编码、安装、真实模型外呼或发布。
- 固定约束：不改 `vendor/`；不改变业务行为；不伪造事实；partial 不冒充 complete；未执行验证不写成通过。
- 状态用词：`现状` 为源码核对，`设计` 为拟议实现，`待验证` 为实施后验证，`不适用` 附机制缺失依据。

## 需求评审

### 适用范围

对总表与 DSH 当前 `KNOWN_SESSION_EVENT_TYPES` 核对后，100 行的适用集合固定如下；注册表中不在总表的 `step/start`、`step/end`、`turn/start`、`session/end-seed`、`schedule/change`、`session-log-deepseek/delivery-accepted` 不计入分母。

| 分类 | 数量 | 处理 |
|---|---:|---|
| DSH 已有，核心信息完整 | 36 | 探针只读关联，不写重复记录 |
| DSH 已有，需补字段 | 20 | 探针可观察部分写伴随事实；不可观察部分定点补字段 |
| 共享候选事件 | 15 | 探针优先；不可观察项定点新增 log-only 事件 |
| DSH 有 steer 机制但无会话事件 | 1 | 定点在 manager 受理点写 log-only 事件 |
| APUS 专属机制 | 28 | 不适用，不移植、不伪造 |

28 项不适用：`model/selection-reset`、`model/automatic-selection`、`reflex/context-cache-anchor`、`reflex/context-projection`、`subagent/supervision-recovery`、`subagent/supervision-steer`、`continuum/*`（#65–70）、`system3/*`（#71–86）。这些 key 在 DSH 当前源码中没有生产机制。

### 原则与决策规则

**探针优先。** 判据按以下顺序执行，命中即由探针记录：

1. 事实已是公开 live 事件或公开 Session 事件，且探针可读取。
2. 事实可通过公开 waterfall 的 prepend/pass-through 包裹获得，且 `next()` 恰好调用一次。
3. 事实可通过公开服务方法读取，例如 `workspaceChanges.summary`。

**定点补全。** 仅当上述三步都失败时，在事实属主处做最小补全：

1. 现有事件可安全增加可选字段时，原位补字段。
2. 否则新增 `ignorable: true` 的 log-only 事件，进入该包声明合并与生成注册表。
3. 补全只写事实，不重新执行工具、不重跑摘要、不额外请求模型、不改变任何返回。

**唯一生产者。** 每个 `canonicalKey + subject` 在一个部署中只有一个生产者。探针的覆盖表明确标注“只读关联、不写 canonical 事实”的点；定点代码只写自己拥有的点。AutoEval 按同一键校验重复；迁移期若某点从探针 partial 切换为定点 complete，探针在 status 中记录停止时间，双方不并存。

### 取舍

| 方案 | 结果 | 决定 |
|---|---|---|
| 仅外挂探针 | 不改 DSH，但私有事实只能 partial，无法完整 | 不作为唯一手段 |
| 通用观察端口 | 统一但新增基础设施层，所有包反向依赖端口包 | 不采用；用户明确要求定点补全 |
| 探针优先＋定点补全 | 探针覆盖公开事实；少量属主改动可枚举、可单独评审 | 采用 |

定点补全比通用端口触及更多文件，但每处改动只服务一个记录点，评审面小、回退独立；这是本方案接受的代价。

### 完成判据

| 判据 | 通过条件 |
|---|---|
| 范围完整 | 56/20/15/1/28 每项有归属、生产者与判定；28 项附源码依据 |
| 完整度诚实 | complete 有字段来源；partial 有 missing；not_applicable 不进入分子 |
| 唯一生产 | 每个 canonicalKey+subject 只有一份记录；探针与定点不双写 |
| 业务不变 | 过滤新增记录后，模型历史、ToolBatchResult、审批/问答、重试、调度、错误与基线一致 |
| 故障隔离 | 探针写入或定点记录失败不改业务返回；无递归、无未释放 listener |
| 兼容 | 不含新增记录的读取方跳过且模型历史不变；不要求 Session 升版 |

## 总体架构

### 组件

| 组件 | 位置 | 职责 |
|---|---|---|
| `dsh-trajectory-probe` | AutoEval：`/home/Project/AutoEval/probes/dsh-trajectory-probe/` | 公开事件监听、公开服务读取、waterfall 包裹、关联索引、写 `plugin:autoeval/*` |
| 定点补全 | DSH 各事实属主包 | 在探针不可见的点增加可选字段或 log-only 事件 |
| 现有事件 | DSH 现状 | 探针只读关联；36 个完整事件不重复建设 |

### 数据流

```text
公开 live/Session 事件 ─┐
public waterfall 包裹  ─┼→ 探针 ProbeRuntime → appendPluginRecord(plugin:autoeval/fact)
公开服务读取          ─┘

探针不可见事实 → 属主在提交点 → 可选字段或 log-only 事件（直接写 Session）
```

两类记录都在同一 Session 日志中；探针不复制属主已写的 canonical 事件，属主也不写 `plugin:autoeval/*`。

### 记录合同

探针 fact：

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

探针 status 记录实例、版本、启停时间、已见 session 树、droppedRecords 与最后错误。关联优先使用真实 id；缺失不生成假值。同一键去重由探针索引和 AutoEval 校验共同完成。

## 外挂探针设计

### 包与挂载

探针为独立 Node 包，peer dependency 只使用当前 DSH 构建的公开包：`@deepseek-ai/cordis`、`@deepseek-ai/dsh-session` 与实际使用的公开类型包；禁止 import DSH `src/**`、私有路径或 `vendor/**`。

AutoEval overlay：

```yaml
- insert:
    - id: autoeval-trajectory-probe
      name: /home/Project/AutoEval/probes/dsh-trajectory-probe/lib/index.js
      config:
        enabledFacts: [inbox, request, attempt, catalog, pipeline, subagent-read, workspace]
        includeChildSessions: true
```

`enabledFacts` 只包含探针负责产出的点；定点补全负责的点不列在这里，避免双写。插件在首个 Agent 动作前挂载；晚挂载造成的开始前缺失写 partial，不补造。

### 结构

| 成员 | 职责 |
|---|---|
| `ProbeRuntime` | 实例私有；session/turn/call/run 索引、droppedRecords、instanceId；卸载清空 |
| `LiveCollector` | 公开 live/Session 事件监听；只读、去重、补 subject |
| `WaterfallObserver` | 包裹公开 waterfall；pass-through、异常透传、只记事实 |
| `ServiceReader` | 只读调用公开服务（如 workspaceChanges.summary） |
| `RecordWriter` | `appendPluginRecord`；单条失败 containment；schemaVersion |
| `StatusWriter` | 启停、启用集合、覆盖声明；不写业务事实 |

不使用模块级 singleton。`session/event` 回调只更新索引，不再 append，并跳过 `plugin:autoeval/` 前缀，防止递归。

### 透明监听

对 `agent/pre-step`、`agent/request`、`system-prompt/assemble`、`tools/pre-execute`、`tools/execute`、`tools/post-execute`、`approval/request`、`user-questions/request` 使用 `{ global: true, prepend: true }`：读取公开参数，原样 `await next()` 一次，记录后返回原结果；异常记录后抛出原 error。不得修改 messages、decision、signal、tools、answers、重试次数或顺序。

对 `subagent/start`、`subagent/end`、`agent/assistant-stream` 只读观察。探针不注册 answerer，不替审批/问答作答。

### 故障边界

- `appendPluginRecord` 失败只捕获该调用，`logger.warn` 并增加 droppedRecords；原返回/异常不变。
- 无后台队列与重试；进程崩溃时已写记录保留，未写事实由 AutoEval 以缺失检出。
- 卸载注销全部 listener、清空索引、写最终 status；不等待后台任务。
- 记录失败不触发业务重试，不回滚已提交状态。

## 探针优先覆盖

下表是探针单独可覆盖到的记录点。“complete”表示探针通过公开面能拿全该点当前场景字段，由探针写 fact；“partial”表示探针只能看到部分，**该点不由探针写**，只保留关联索引，由“定点补全”成为唯一生产者；“只读”表示该点已由现有事件完整承载。

| 记录点 | 探针来源 | 探针覆盖 | 处理 |
|---|---|---|---|
| #1 agent/inbox/spliced | inbox 事件 + pre-step 包裹 | complete（disposition、拒绝 id） | 探针写 |
| #2 user/message | 事件 source | complete（synthesizedSource 归类） | 探针写 |
| #10 request/header | header 事件 + assemble 前后 diff | complete | 探针写 |
| #11 request/context | assemble 前后 diff + header | complete | 探针写 |
| #16 assistant/attempt | `agent/assistant-stream` 开始/结束 | complete（failure、时间带） | 探针写 |
| #21 tool/result-rewrite | 三个 tools waterfall 包裹 | partial（阶段级可见，listener 个体不可见） | 定点（探针只读） |
| #22 tool/pipeline-error | 三个 tools waterfall 包裹 | partial（可见阶段与 error；内部 project/finalize 不可见） | 定点（探针只读） |
| #45 user-question/answered | `user-questions/request` 包裹 | partial（答案可见；answeredBy 不可见） | 定点（探针只读） |
| #99 workspace/changes | `workspace/changes` 事件 + `workspaceChanges.summary` | complete（files/stat/digest，截断保留 total） | 探针写 |
| #7 tool/catalog-resolved | assemble 前后可见集 | partial（最终集可见；registry/when/executor skipReason 不可见） | skipReason 定点 |
| #8 skill/loaded | tool-skill 调用与结果 | partial（name/provider/时间；loadedAt/cached 不可见） | 定点 |
| #9 turn/pre-step | pre-step 包裹 | partial（决策与消息可见；rejectReason 不可见） | 原因定点 |
| #23 tool/pre-execute-decision | pre-execute 包裹 | partial（聚合 gate；逐票不可见） | 定点 |
| #24 tool/execute-deadline | execute 包裹 | partial（elapsed/error；内部 timer 不可见） | 定点 |
| #26 tool/execution-plan | tool 事件时间带 | partial（现象可见；batch 内部不可见） | 定点 |
| #27 spill/spilled | post-execute 前后 | partial（最终面可见；threshold 不可见） | 定点 |
| #31 tool/provider-selected | deepseek request 事件 | partial（仅该 provider） | 定点 |
| #32 turn/stopping | turn 收束包裹 | partial（是否继续；逐票不可见） | 定点 |
| #44 approval/unavailable | pre-execute 包裹 | partial（下游结果；serviceAsk 前路径不可见） | 定点 |
| #53 subagent/run-end | subagent start/end | partial（时长/输出；steers 不可见） | 定点 |
| #17/#18 llm/retry* | request-error 包裹 | partial（失败可见；trigger/复用/代次不可见） | 定点 |
| #20 tool/result provenance | tool/result 事件 | partial（结果可见；executor 身份不可见） | 定点 |
| #28/#29 ptc dispatch | 现有事件 + 时间带 | partial（调用可见；maxParallel/提交序不可见） | 定点 |
| #33 turn/end | turn 收尾包裹 | partial（结局可见；blocked 原因不可见） | 定点 |
| #34–37 compaction | compaction 事件 | partial（区间/摘要可见；trigger/保留/代次不可见） | 定点 |
| #42 approval/decided | approval/request 包裹 | partial（outcome 可见；responder 不可见） | 定点 |
| #52 subagent model policy | 现有策略事件 | partial（策略可见；逐实例路由不可见） | 定点 |
| #91 web search | deepseek request 事件 | partial（单 provider） | 定点 |
| #95 goal/change | goal 事件 | partial（变更可见；blocked rounds 不可见） | 定点 |

`#25 tool/retry-started` 当前无通用工具重试 wrapper，记 not_applicable；`#54 subagent/steer` 的 delivery 不可从公开事件区分，定点补。

## 定点补全

只列探针不可见或不足的点。每处只在该包原有提交点之后写入，失败 containment 与原业务无关。

| 记录点 | 探针为何不足 | DSH 定点位置 | 补全方式 | 深度 | 补全后 |
|---|---|---|---|---|---|
| #7 skipReason | registry restriction、`when`、executor describe 不公开 | [core/tools/src/index.ts](../../packages/core/tools/src/index.ts) `resolve`；native/PTC `describe` | 新增 `tool/catalog-resolved` log-only 事件，记录逐阶段 skipReason 与最终集 digest | L2 | complete |
| #8 skill | 缓存与真实 loadedAt 不公开 | [skill/skill/src/index.ts](../../packages/skill/skill/src/index.ts) `get`/`collect` | 新增 `skill/loaded` log-only 事件；缓存不可得时 missing | L2 | complete/partial |
| #9 rejectReason | `PreStepDecision.reject` 无原因字段 | [core/agent/src/runtime-types.ts](../../packages/core/agent/src/runtime-types.ts)；[agent-loop/src/agent.ts](../../packages/core/agent-loop/src/agent.ts) | reject 增加可选 `observation.reason`；拒绝者填充；agent-loop 写 `turn/pre-step` | L1/L2 | complete |
| #17/#18 retry | trigger、装配复用、压缩代次在 loop 内 | [llm/llm-retry/src/index.ts](../../packages/llm/llm-retry/src/index.ts)；agent-loop request-error | retry 事件增加可选字段；由 loop 提供 assemblyDigest、compactionGeneration | L1 | complete |
| #20 provenance | executor 选择与沙箱模式不公开 | [core/tools/src/index.ts](../../packages/core/tools/src/index.ts) `selectExecutor`/`execute` | 新增 `tool/result-provenance` log-only 事件；工具定义可声明 pluginOwner/providerId | L2 | complete（声明者）/partial（未声明） |
| #21 listener 个体 | waterfall 只给聚合 | [core/tools/src/pipeline.ts](../../packages/core/tools/src/pipeline.ts)；内置 post/project/finalize 监听器 | pipeline 写阶段级改写事件；内置 listener 自报 listenerId 与 digest | L2/L3 | complete（内置）/partial（外部） |
| #22 内部阶段 | project/finalize 不在 waterfall | [core/tools/src/pipeline.ts](../../packages/core/tools/src/pipeline.ts) | 在内部 stage 边界写 `tool/pipeline-error`；thrower 未声明时留空 | L2 | complete（阶段）/partial（thrower） |
| #23 逐票 | 其他 listener 决策不可见 | 内置 pre-execute 监听器（[hooks-claude-code](../../packages/experimental/hooks-claude-code/src/index.ts)、[hooks-codex](../../packages/experimental/hooks-codex/src/index.ts)、[auto-review](../../packages/experimental/auto-review/src/index.ts)、[workspace-changes](../../packages/deliverables/workspace-changes/src/index.ts)、[tool-jobs](../../packages/jobs/tool-jobs/src/index.ts)）与已注册 guard | 各监听器在自身决定后写 `tool/pre-execute-decision`；外部监听器不写 | L2 | complete（内置）/partial（外部） |
| #24 deadline | timer 归属与 signal 替换在包装器内 | [guard/timeout-policy/src/index.ts](../../packages/guard/timeout-policy/src/index.ts) | 在 arm/fire/restore 后写 `tool/execute-deadline` | L2 | complete |
| #26 execution-plan | batch 分类与池在内部 | [core/tools/src/batch.ts](../../packages/core/tools/src/batch.ts) `runGroup` | 在 group 开始/重分类/提交后写 `tool/execution-plan` | L2 | complete |
| #27 spill | threshold 与记账在策略内 | [spill/spill-policy/src/index.ts](../../packages/spill/spill-policy/src/index.ts) | 在 spill 决策处写 `spill/spilled` | L2 | complete |
| #28/#29 PTC | maxParallel 与提交序在 executor | [core/tool-executor-ptc/src/index.ts](../../packages/core/tool-executor-ptc/src/index.ts) | 现有 dispatch 事件扩可选字段；settled 时写重叠度 | L1/L2 | complete |
| #31 provider | web/lsp 路由不公开 | [web/web/src/index.ts](../../packages/web/web/src/index.ts) `resolveProvider`；[lsp/lsp/src/index.ts](../../packages/lsp/lsp/src/index.ts) `query` | 写 `tool/provider-selected`，记录真实选择与耗时；无 fallback 不编造 | L2 | complete |
| #32 逐票 | serial 通知无投票载荷 | 内置 turn-stopping 监听器（[workspace-changes](../../packages/deliverables/workspace-changes/src/index.ts)、[hooks-claude-code](../../packages/experimental/hooks-claude-code/src/index.ts)、[hooks-codex](../../packages/experimental/hooks-codex/src/index.ts)） | 各自写 `turn/stopping`；agent-loop 写 settled 汇总 | L2 | complete（内置）/partial（外部） |
| #33 blocked 原因 | turn/end 只留结局 | [agent-loop/src/agent.ts](../../packages/core/agent-loop/src/agent.ts) | 用 #9 的观察 seq 关联；必要时扩可选字段 | L1 | complete |
| #34–37 compaction | trigger/保留/代次在 backend | [compaction/compaction-basic/src/index.ts](../../packages/compaction/compaction-basic/src/index.ts) `compactIfNeeded` | 现有事件扩可选字段；trigger 由调用点传入 | L1 | complete |
| #42 responder | aggregate 不含身份 | [interaction/user-approval/src/index.ts](../../packages/interaction/user-approval/src/index.ts) | 内置 answerer 自报 responder；SDK bridge 标 `sdk-host`；外部 unknown | L2 | complete（自报）/partial |
| #44 unavailable | serviceAsk 之前的分支不可见 | [core/tools/src/pipeline.ts](../../packages/core/tools/src/pipeline.ts) `serviceAsk` | 在 no-service/no-agent 分支写 `approval/unavailable`；无 Agent 不写 Session | L2 | complete |
| #45 answeredBy | 只有答案，没有应答者 | [interaction/tool-ask-user/src/index.ts](../../packages/interaction/tool-ask-user/src/index.ts)；[user-questions](../../packages/interaction/user-questions/src/index.ts) | 现有答案路径上写 `user-question/answered`；responder 自报 | L2 | complete（自报）/partial |
| #52 实例路由 | 策略事件早于实例创建 | [subagent/tool-subagent/src/model-selection-state.ts](../../packages/subagent/tool-subagent/src/model-selection-state.ts) | 另写 `subagent/model-selection-observation` log-only 事件 | L2 | complete |
| #53 run-end | 无公开 run-level steers | [subagent/subagent/src/manager.ts](../../packages/subagent/subagent/src/manager.ts)；[lifecycle.ts](../../packages/subagent/subagent/src/lifecycle.ts) | Activation observer 记录 start/steers；settle 写 `subagent/run-end` | L2 | complete（本地）/partial（远端） |
| #54 steer | delivery 不可从事件区分 | [subagent/subagent/src/manager.ts](../../packages/subagent/subagent/src/manager.ts) `deliver` | 受理成功后写 `subagent/steer`，记录 delivery/text/messageId | L2 | complete（本地） |
| #91 web 延迟/链 | 只有单 provider 请求事件 | [web/web/src/index.ts](../../packages/web/web/src/index.ts) | 写 `web/search-route`；无 fallback 记单次选择 | L2 | complete |
| #95 blocked rounds | goal 内部状态 | [goal/goal/src/index.ts](../../packages/goal/goal/src/index.ts) | `goal/change` 扩可选字段 | L1 | complete |

定点补全共同约束：

1. 只在新事实已经确定后写；原提交先发生。
2. 新事件 `ignorable: true`、log-only、非 surface；不进入模型历史。
3. 新字段只增可选属性；persistence 工具要求升版时停止该直接扩展，改 log-only 事件。
4. 写入失败只告警，不改变原返回/异常；不重试业务。
5. 外部监听器、外部 answerer、第三方包装器未接入时保持 partial；不从栈、路径或类名猜身份。

## 合并覆盖与残余

### 候选与补充点

| 序号 | 记录点 | 生产者 | 最终覆盖 |
|---:|---|---|---|
| 7 | tool/catalog-resolved | 定点 core/tools + executor | complete |
| 8 | skill/loaded | 定点 skill | complete（缓存不可得 partial） |
| 9 | turn/pre-step | 定点 agent-loop + 拒绝者 | complete |
| 21 | tool/result-rewrite | 定点 pipeline + 内置 listener | complete（内置）/partial（外部） |
| 22 | tool/pipeline-error | 定点 pipeline | complete（阶段）/partial（thrower） |
| 23 | tool/pre-execute-decision | 定点内置监听器/guard | complete（内置）/partial（外部） |
| 24 | tool/execute-deadline | 定点 timeout-policy | complete |
| 25 | tool/retry-started | 无机制 | not_applicable |
| 26 | tool/execution-plan | 定点 batch | complete |
| 27 | spill/spilled | 定点 spill-policy | complete |
| 31 | tool/provider-selected | 定点 web/lsp | complete |
| 32 | turn/stopping | 定点内置监听器 + agent-loop | complete（内置）/partial（外部） |
| 44 | approval/unavailable | 定点 pipeline | complete |
| 45 | user-question/answered | 定点 tool-ask-user/user-questions | complete（自报）/partial |
| 53 | subagent/run-end | 定点 manager/observer | complete（本地）/partial（远端） |
| 54 | subagent/steer | 定点 manager | complete（本地） |

### 残余

| 类别 | 记录点 | 原因 |
|---|---|---|
| 外部监听器个体归因 | #21、#23、#32 | 未接入定点自报；不读 Cordis 内部 |
| 未自报 answerer | #42、#45 responder | 服务只拿 aggregate |
| 第三方包装器内部 | #24、#25 | 无公开事实 |
| 远端 subagent | #53 steers | provider 不暴露 |
| 无机制 | #25 | 当前无通用工具重试 |
| APUS 专属 | 28 项 | DSH 无机制 |

AutoEval 报告必须分列 complete/partial/not_applicable；partial 不计入“100 项完整”。

## 兼容与回退

1. 探针记录走 `appendPluginRecord`，自动 `ignorable: true`，不进入模型历史，不需要 DSH 注册表或 persistence-change 记录。
2. 定点新增 log-only 事件进入声明合并与生成注册表；可选字段走 same-version 规则；工具要求升版时改 log-only 事件或退回评审。
3. 不含新增记录的读取方按 ignorable 跳过；模型历史不变。
4. 回退按生产者独立：移除 overlay 停止探针；撤销某定点改动停止该事件/字段。已写记录保留且不影响业务。
5. 迁移期同一 canonicalKey 不双写：探针 status 记录停用时间，AutoEval 按键校验。

## 开发规范

1. 探针只依赖公开包与公开 API；不 import `src/**`、私有路径或 `vendor/**`。
2. 定点改动在事实属主包内完成；新增类型用声明合并，事件默认 ignorable，不进 surface。
3. 每个上报点写在原决策之后、原返回之前；不改变顺序、信号、返回或异常。
4. 新字段必须是已有数据或确定性计算；不重新执行工具、摘要或模型。
5. 写入失败只告警计数；禁止空 catch；命名错误并说明业务不受影响。
6. 探针不使用全局单例；`session/event` 回调不 append；卸载注销 listener。
7. 每包同步 README、JSDoc、subsystem、快照与 TS/Python expected outputs。
8. 可归因身份必须显式；不从路径、栈或类名推断。

## 环境配置

- Node `>=24.9.0`、pnpm `11.28.5`；探针同范围。
- 不新增环境变量、服务、数据库、凭据或端口。
- 探针 `lib/index.js` 由 AutoEval 构建；DSH 只构建定点包。
- 实施后运行：受影响包单测、`pnpm run build:artifacts`、`pnpm run build:check`、`pnpm run doc-sync`；本方案未执行。
- 不修改 DSH profile、cordis 配置或运行时目录；overlay 只在 AutoEval 维护。

## 测试方法

| 编号 | 场景 | 独立预期 |
|---|---|---|
| T-01 | 无探针、有探针分别跑同一 fixture，过滤新增记录 | 模型历史、ToolBatchResult、审批/问答、重试、调度、错误一致 |
| T-02 | 探针 waterfall 正常/异常；append 失败；自记录 | next 恰好一次；原异常不变；无递归 |
| T-03 | 定点事件在探针存在/不存在时运行 | 唯一生产；无重复 canonicalKey；业务不变 |
| T-04 | native/PTC、catalog skip、batch 重分类 | skipReason、executor、调度事实完整 |
| T-05 | 内置与外部监听器混合的 pre-execute/turn-stopping | 内置完整；外部 partial；gate/收束结果不变 |
| T-06 | timeout、spill、compaction、retry | 内部字段与真实决策一致；无重跑 |
| T-07 | 审批/问答有/无 answerer | 有答案完整；无答案保持原 degrade |
| T-08 | subagent 正常/error/steer 受理与拒绝 | run-end/steer 只在真实受理后写；时长一致 |
| T-09 | web/lsp 单选/无可用/歧义 | 不编造 fallback |
| T-10 | 无探针恢复含 plugin record 的日志 | 模型历史不变；记录保留 |
| T-11 | 28 项与 #25 | 不产生虚假记录；报告 not_applicable |

复用现有 Session/Agent/tool/executor/SDK 工厂；业务快照与新增记录分文件；固定时钟与 id。按 `packages/*/*/src` 覆盖率要求执行；负例覆盖漏记、误标 complete、双写、递归、读取方不跳过。方案阶段不填覆盖率或变异通过率。

## 实施批次

| 批次 | 内容 | 停止条件 |
|---|---|---|
| W0 | 范围账、基线 fixture、差分器、探针骨架与 overlay | 业务与新增记录无法分离 |
| W1 | 探针 live/waterfall/service 采集、fact/status、去重、递归防护 | 双写、递归或业务差分 |
| W2 | 探针优先点（#1、#2、#10、#11、#16、#99 等）与 SDK 可达验证 | 记录缺失或业务差分 |
| W3 | core/tools 定点（#7、#20–#24、#26、#27）与 native/PTC 验证 | ToolBatchResult/顺序变化 |
| W4 | agent-loop、审批/问答、subagent、compaction、web/lsp、goal 定点 | 业务决定/异常/顺序变化 |
| W5 | 内置监听器/answerer 自报、覆盖报告、残余 partial 清单 | partial 被标 complete |
| W6 | 真实组合、故障注入、无探针恢复、全量差分 | silent partial、双写或业务差分 |

W1/W2 先行；W3/W4 不共享文件时可并行，`core/tools` 与 `agent-loop` 由指定维护者集成。每批独立评审与回退。

## 集中待确认事项

1. 是否接受“探针优先＋定点补全”的判据顺序与唯一生产者规则；定点补全预计触及约 15 个包，是否属于可接受的最小侵入。
2. 是否接受 complete/partial/not_applicable 三态，外部监听器、未自报 answerer、远端 steers 保持 partial。
3. 是否接受内置监听器/answerer 自报以补齐 #23/#32/#42/#45；拒绝则这些点保持 partial。
4. 是否确认 28 项 APUS 专属与 #25 记 not_applicable，不在 DSH 新建 System3/Continuum/Reflex 或工具重试。
5. 探针由 AutoEval 持有、DSH 只接收定点改动，是否确认该仓边界。
6. plugin record 跨格式保留为 best-effort，不作为业务恢复依据，是否接受。

未确认前本文是可评审设计，不构成实施批准；即使全部获准，DSH 只负责产生事实与记录，Langfuse 的最终覆盖仍需 AutoEval 采集与完整性检查共同验收。
