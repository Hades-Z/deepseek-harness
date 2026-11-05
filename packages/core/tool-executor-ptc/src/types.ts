/**
 * Client-safe PTC dispatch events and message-source declarations.
 *
 * @module @deepseek-ai/dsh-tool-executor-ptc/types
 */

import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Payload recorded when one nested PTC mode Tool dispatch starts. */
export interface PtcDispatchStartEventData {
  rootCallId: ToolCallId
  parentCallId: ToolCallId
  subCallId: ToolCallId
  name: string
  arguments: unknown
  /**
   * The effective overlap cap in force when this dispatch started (the run's
   * configured `maxParallelSubCalls`), so a reader reconstructs the overlap
   * budget the scheduler admitted this call under without reading config.
   * Absent on records written before this field was introduced.
   */
  maxParallel?: number
  /**
   * This dispatch's position in submission order (1-based), matching the
   * numeric suffix of `subCallId` (`<parent>:ptc:<n>`). The first call a
   * `run_code` program makes is `1`. Absent on records written before this
   * field was introduced.
   */
  submissionOrder?: number
}

/** Payload recorded when one nested PTC mode Tool dispatch settles. */
export interface PtcDispatchEventData extends PtcDispatchStartEventData {
  isError: boolean
  content: ContentBlock[]
  /** Replayable tool-owned presentation metadata, separate from model content. */
  meta?: JsonValue
  /** Optional failure identity and raw user-facing detail, outside model-facing content. */
  error?: { name: string; code: string; reason?: string }
  /**
   * How many other dispatches were already in flight when this call was
   * admitted to the pool (the overlap degree at this call's start): `0` means
   * the call ran with no overlapping sibling, `2` means two other calls were
   * already running. The scheduler reads this from its in-flight set at start
   * time and records it at settle so a reader reconstructs the actual overlap
   * without aligning start timestamps. Absent on records written before this
   * field was introduced.
   */
  overlapAtStart?: number
}

/**
 * Payload recorded once when one `run_code` program's whole batch settles:
 * the run-wide overlap summary the per-dispatch events cannot carry alone.
 * Non-surface (log-only): the model never sees it.
 */
export interface PtcSettledOverlapEventData {
  /** The outer `run_code` call id this summary covers; also the parent of every sub-call. */
  rootCallId: ToolCallId
  /** The effective overlap cap the scheduler admitted calls under for this run. */
  maxParallel: number
  /** Total calls the program submitted (the highest submission order reached). */
  dispatched: number
  /** Calls that reached a settled `tool/ptc-dispatch` outcome. */
  settled: number
  /** Largest in-flight count observed during the run (peak actual overlap). */
  peakOverlap: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One sub-dispatch STARTING inside a `run_code` program: the parent
     * `run_code` call id, the opaque sub-call id (new calls use
     * `<parent>:ptc:<n>`, numbered in submission order), and the tool `name` with its
     * JSON-normalized `arguments` — the exact value dispatched, normalized
     * BEFORE dispatch, so this append can never fail on payload shape.
     * Appended when the scheduler actually starts the call (not at
     * submission), so a start means the tool body pipeline was entered; a
     * call abandoned in the queue logs nothing. Log-only: `deriveMessages()`
     * ignores it; UIs use it for live per-sub-call running state and pair it
     * with `tool/ptc-dispatch` by `subCallId` (timing = the two events'
     * `time` fields).
     * @param data - the start payload.
     */
    'tool/ptc-dispatch-start': PtcDispatchStartEventData
    /**
     * One bridged sub-dispatch SETTLING: the pairing ids (matching the
     * `tool/ptc-dispatch-start` with the same `subCallId`), the tool `name`
     * with the same JSON-normalized `arguments`, and the sub-call's complete
     * durable outcome in `tool/result`'s own vocabulary (`content` + `isError`
     * + optional presentation `meta` and structured `error`), so UIs and SDKs
     * render a sub-call through the exact path used for a native call. Every started sub-call settles
     * with exactly one of these (abort included: the aborted pipeline result
     * is an `isError` outcome).
     * Log-only: `deriveMessages()` ignores it, so sub-calls never re-enter
     * model context; persistence and UIs get every call. Appended inside the
     * parent `run_code`'s execution (the bridge drains in-flight dispatches
     * before returning), so its execution-enclosure relation holds by
     * construction.
     * @param data - the settle payload.
     */
    'tool/ptc-dispatch': PtcDispatchEventData
    /**
     * One `run_code` program's whole-dispatch overlap summary, appended once
     * when the bridge settles the run (after draining every in-flight and
     * committed dispatch, before the outer call returns). Carries the
     * run-wide facts a per-dispatch event cannot: the effective `maxParallel`
     * cap, how many calls the program submitted, how many reached a settled
     * outcome (started calls always settle; queued-unstarted calls abandoned
     * at run settlement do not), and the peak overlap actually observed
     * (the largest in-flight count during the run). A reader reconstructs the
     * scheduler's actual concurrency behavior — not just the configured cap —
     * from this one record, without aligning per-dispatch start timestamps.
     * Log-only: `deriveMessages()` ignores it; it never enters model context.
     * @param data - the run-wide overlap summary.
     */
    'ptc/settled-overlap': PtcSettledOverlapEventData
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Images deferred from a successful PTC subcall's final result. */
    'ptc-mode': { kind: 'ptc-mode' }
  }
}
