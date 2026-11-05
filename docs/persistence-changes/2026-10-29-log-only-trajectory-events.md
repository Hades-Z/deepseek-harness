---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-10-29-log-only-trajectory-events

English | [中文](2026-10-29-log-only-trajectory-events.zh.md)

## Summary

Adds twenty log-only Session events and optional observation fields to tool, turn, compaction, retry, goal, PTC, approval, skill, spill, subagent, user-question, and web records.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

Existing records remain valid: every added field is optional and an absent field keeps its prior meaning, so readers decode old logs unchanged; the approval responder, compaction trigger and closing decision, retry trigger and assembly facts, goal blocked rounds, and PTC overlap fields are written only by new appends. The twenty new event types are required-on-read SessionEventMap members. They are log-only and never enter model context, but an older build refuses a Session that carries one rather than truncating or reinterpreting the tail. Absence of a new event is not evidence that the recorded operation did not happen. No Session header, event envelope, or existing required field changes, and SESSION_FORMAT_VERSION stays at 4. `tool/pipeline-error` also widens its `stage` union to name `pre-execute`, `execute-wrapper`, and `post-execute`; the variants are additive and the union is documented as open within this version, so a reader that meets an unrecognized stage still knows the failure was internal and drains the record rather than rejecting the Session.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/core/tools/tests packages/core/agent-loop/tests/contract-regressions.spec.ts: 318 tests passed. packages/compaction/compaction-basic, packages/compaction/compaction, packages/llm/llm-retry, packages/goal/goal: 386 tests passed. packages/core/tool-executor-ptc, packages/guard/timeout-policy, packages/interaction/user-questions, packages/skill/skill, packages/spill/spill-policy: 462 tests passed. packages/subagent/subagent, packages/subagent/tool-subagent, packages/web/web, packages/web/web-search-deepseek, packages/deliverables/workspace-changes, packages/interaction/user-approval: 1400 tests passed; the single failure is an unrelated out-of-process directory-permission spec whose chmod 600 fixture stays searchable for root. pnpm run gen-persistence-catalog regenerated the catalog, inventories, and known-event types.

<a id="dev-note"></a>
## Dev Note

None.
