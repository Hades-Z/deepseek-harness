---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-29-log-only-trajectory-events

[English](2026-10-29-log-only-trajectory-events.md) | 中文

## 概述

新增 20 个仅写入日志的 Session 事件，并在 tool、turn、compaction、retry、goal、PTC、approval、skill、spill、subagent、user-question 和 web 记录中加入可选观测字段。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-29-log-only-trajectory-events
baseline: false
changes:
  - root: "event:approval/decided"
    previous: "2026-09-11-initial"
    after: "7ce79f035851862ab3a9b43685ddf592de71eb271210534fcb5adae5b898f94b"
    decision: same-version
  - root: "event:approval/unavailable"
    previous: null
    after: "06016ddfac0f46115c07f4f5aa9957d126ceed8d305069872cac9785a6209803"
    decision: same-version
  - root: "event:compaction/end"
    previous: "2026-09-11-initial"
    after: "465928649d1f783833f94c56e32973f4c8d83d4ddfac4a9fb08b2367c81d1e35"
    decision: same-version
  - root: "event:compaction/start"
    previous: "2026-09-11-initial"
    after: "a48be58288d1363c6cfa056611294d651d69396526dd1569429aa790bc0a2e92"
    decision: same-version
  - root: "event:goal/change"
    previous: "2026-09-11-initial"
    after: "24f0513074c672f984b6041da6553a38b4bef0743a50a72718ca213fc676fddd"
    decision: same-version
  - root: "event:llm/retry"
    previous: "2026-09-14-image-offload"
    after: "df4f3d021f62f98abceadf3f6b48b64b04e859ef7b36a1ae6e7acd140f16534f"
    decision: same-version
  - root: "event:llm/retry-started"
    previous: "2026-09-11-initial"
    after: "2862cc1d92c189c5e69a2ecf05b14acf0f4925d5649a4ce0c14c42adf1026ef5"
    decision: same-version
  - root: "event:ptc/settled-overlap"
    previous: null
    after: "8e358a4dbd6390066f7769553816f854ec486c93bddc8e078e1402b48e1ec89f"
    decision: same-version
  - root: "event:skill/loaded"
    previous: null
    after: "1959a434beae0d072c284af5badb4d820d4ddbb8de6aea67d9c64e2d57649fba"
    decision: same-version
  - root: "event:spill/spilled"
    previous: null
    after: "7643c1cdd0e106d9b3a63a6da7cc3036cc969b8087efcaaf3093cabc1afa6bf7"
    decision: same-version
  - root: "event:subagent/model-selection-observation"
    previous: null
    after: "4beaa17506f917ebba34fef47f0821f19547052e3ab3e72a0aa7720d8d3c1822"
    decision: same-version
  - root: "event:subagent/run-end"
    previous: null
    after: "8e68f2d706e61790318af16095f76f6b61d1a3c6a5c84955cc2e6b25a764d2bf"
    decision: same-version
  - root: "event:subagent/steer"
    previous: null
    after: "37dd01e8be702adceb537657fea72653b1403b08524bf4a612855bc81940d344"
    decision: same-version
  - root: "event:tool/catalog-exposed"
    previous: null
    after: "da8fe66505f7afd13bd0e138505d187d6e4ce840c65774a347020b17457019fe"
    decision: same-version
  - root: "event:tool/catalog-resolved"
    previous: null
    after: "dc0ae65bde2e3b57c0213f4c91850dcbf5a49fbc23e086266caa4418f9c292d3"
    decision: same-version
  - root: "event:tool/execute-deadline"
    previous: null
    after: "d5689a837cddcf6c2992d2d33d9c3da88613b4098c2eb804cf65f654c81b99aa"
    decision: same-version
  - root: "event:tool/execution-plan"
    previous: null
    after: "15db9bddf83e9f680c29148a2d6e652f384af1df64d92bcc3ed20e13745dd199"
    decision: same-version
  - root: "event:tool/pipeline-error"
    previous: null
    after: "0e29b09983e2b44312c63df21ce82060c1aee35e345efdea63258e4f54dfcb90"
    decision: same-version
  - root: "event:tool/pre-execute-decision"
    previous: null
    after: "00bbbb02c2ade35bff3ad5cacbaf7b2b74e328bf4887c520d5abc7add6513fc3"
    decision: same-version
  - root: "event:tool/provider-selected"
    previous: null
    after: "54a2635b61f1d5dc5319877a440e55f11b0c305ea1334a9c276c1003aaa6c0b5"
    decision: same-version
  - root: "event:tool/ptc-dispatch"
    previous: "2026-10-05-ptc-operation-metadata"
    after: "6a7aad88d9af1f695743670a0afd4de097377c09ae5844d6fce28148174633d8"
    decision: same-version
  - root: "event:tool/ptc-dispatch-start"
    previous: "2026-09-11-initial"
    after: "7c69a9595aab82b23f7a2e3eed69484220ca2cbf99e2e793f485d65688c2b009"
    decision: same-version
  - root: "event:tool/result-attribution"
    previous: null
    after: "49dc1562e4f1b70260a9b87bc34ce2bfe8b60c2805d5b89e2482ddf433ecb36d"
    decision: same-version
  - root: "event:tool/result-rewrite"
    previous: null
    after: "50ff15bdb130f59b705972dcdefe31f10df9fac1d0bfda54efc2df5056068958"
    decision: same-version
  - root: "event:turn/pre-step"
    previous: null
    after: "b7d4e3369a69daab021c8e3c6b900b6f57b137892f91d17c46023b8cad60b376"
    decision: same-version
  - root: "event:turn/stopping"
    previous: null
    after: "9ed3c1155bd14a6b7c6b0367652501538cc2a390d4adda7f9bd1b02e38ef8927"
    decision: same-version
  - root: "event:user-question/answered"
    previous: null
    after: "ea0c5879208194e0e819bbe87c696a4e24dd3f4e889b233383d7f59e8fc2d074"
    decision: same-version
  - root: "event:web/search-route"
    previous: null
    after: "dba5bf07f52159c89d44722e2d648919fbc6e449e61f9d639ff93f0ab90a3c37"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有记录仍然有效：新增字段全部可选，字段缺失时保持原有含义，读取方解析旧日志的结果不变；approval responder、compaction 的 trigger 与结束决策、retry 的 trigger 与组装信息、goal 的 blockedRounds 以及 PTC 的并发字段只由新的写入路径写入。这 20 个新事件类型是 SessionEventMap 中读取时必需的类型。它们仅写入日志、不进入模型上下文，但旧版本遇到包含这些事件的 Session 会整体拒绝，而不是截断或改写尾部。缺少某个新事件不能证明对应操作没有发生。Session 头、事件信封和既有必填字段均未变化，SESSION_FORMAT_VERSION 保持为 4。`tool/pipeline-error` 同时扩展 `stage` 联合，新增 `pre-execute`、`execute-wrapper` 与 `post-execute`；这些取值是追加的，且该联合在本版本内按开放处理，读到不认识的 stage 仍可判定为工具管道内部失败并正常读出记录，不因此拒收整个 Session。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/core/tools/tests packages/core/agent-loop/tests/contract-regressions.spec.ts：318 个测试通过。packages/compaction/compaction-basic、packages/compaction/compaction、packages/llm/llm-retry、packages/goal/goal：386 个测试通过。packages/core/tool-executor-ptc、packages/guard/timeout-policy、packages/interaction/user-questions、packages/skill/skill、packages/spill/spill-policy：462 个测试通过。packages/subagent/subagent、packages/subagent/tool-subagent、packages/web/web、packages/web/web-search-deepseek、packages/deliverables/workspace-changes、packages/interaction/user-approval：1400 个测试通过；唯一失败是与本次改动无关的 out-of-process 目录权限用例，其 chmod 600 夹具对 root 仍可搜索。pnpm run gen-persistence-catalog 已重新生成目录、清单与已知事件类型。

<a id="dev-note"></a>
## 开发备注

无。
