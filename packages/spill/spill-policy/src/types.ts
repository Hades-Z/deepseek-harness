/**
 * Vocabulary for the spill-policy plugin: the minimal structural view of a tool
 * execution the policy needs to derive the owning session for a spill artifact,
 * and the log-only `spill/spilled` Session event it records at that decision.
 *
 * `@deepseek-ai/dsh-tools`' `ToolExecution` satisfies this view, so the policy
 * reads `exec` straight through without importing `dsh-tools` or `dsh-agent`.
 * It reads the owning session HEADER id — the same identity every other
 * subsystem keys off (see `dsh-tool-bash`'s owner derivation) — and appends the
 * non-surface record to that session.
 *
 * @module @deepseek-ai/dsh-spill-policy/types
 */

import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SpillLocator } from '@deepseek-ai/dsh-spill'

/** Minimal structural view of a tool execution: the owning session and its log target. */
export interface SpillPolicyExec {
  /** The agent on whose behalf the call runs, when there is one. */
  agent?: {
    session: {
      header: {
        /** The canonical session identity — the spill owner. */
        id: SessionId
      }
      /** Append one log-only `spill/spilled` record to the owning session. */
      append(type: 'spill/spilled', data: SpillSpilledEventData): unknown
    }
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Durable, non-surface record of one successful spill decision: the
     * configured inline token threshold, the stored artifact identity, and the
     * quantities omitted from the inline preview. Written after `saveText` and
     * the replacement are committed; an append failure only warns and never
     * changes the returned content. A call without an owning agent/session
     * records nothing.
     * @param data - the spilled artifact, threshold, and omitted quantities.
     */
    'spill/spilled': SpillSpilledEventData
  }
}

/** Payload for one `spill/spilled` record appended by the spill policy. */
export interface SpillSpilledEventData {
  /** The model-issued call id whose content was spilled. */
  readonly callId: ToolCallId
  /** The tool whose result or PTC dispatch log was spilled. */
  readonly toolName: string
  /** Which copy the policy bounded: the tool result or its PTC dispatch log. */
  readonly label: 'result' | 'dispatch'
  /** The configured maximum inline token estimate the content exceeded. */
  readonly threshold: number
  /** The saved artifact's backend locator and full UTF-8 byte length. */
  readonly ref: {
    readonly locator: SpillLocator
    readonly bytes: number
  }
  /** Text bytes omitted from the inline preview. */
  readonly omittedBytes: number
  /** Images omitted from the inline preview. */
  readonly omittedImages: number
  /** SHA-256 of the pre-spill content, so a replay can match the artifact to its source. */
  readonly originalDigest?: string
  /** SHA-256 of the replacement content the model actually received. */
  readonly previewDigest?: string
}
