/**
 * Session vocabulary for the skill seam's log-only trajectory recording point.
 * Types only — the `SkillRegistry` runtime and the record helper live in
 * `index.ts`. One producer: `SkillRegistry.get()` appends the event after a
 * definition validates; `list()`/`snapshot()` discovery never loads bodies and
 * never appends.
 * @module @deepseek-ai/dsh-skill/types
 */

/**
 * Durable payload for `skill/loaded`: one real skill-body load that
 * `SkillRegistry.get()` completed and validated. Discovery consumers see only
 * summaries; the winning provider's `get()` and the collect-cache state
 * are private to the registry, so this records the load facts the trajectory
 * probe cannot observe. The registry never serves definitions from a cache —
 * only discovery candidates are cached — so `loadedAt` is always the real load
 * completion time and the event is `complete` per the plan's fact contract.
 * `turn`/`step` are absent: the trajectory probe joins them from its call-id →
 * turn/step association index, so the event records the load only.
 */
export interface SkillLoadedEventData {
  /** The owning agent's session id. The event is written only when an initiator agent owns a session. */
  readonly sessionId: string
  /** The loaded skill's kebab-case name, equal to the validated definition's name. */
  readonly name: string
  /** Discovery source that produced the winning skill. */
  readonly source: string
  /** Provider that owns the loaded skill body. */
  readonly provider: string
  /** Real `Date.now()` timestamp taken when the provider's load resolved and validated. */
  readonly loadedAt: number
  /** Whether discovery served this load's winning candidate from the registry's collect cache. */
  readonly cached: boolean
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One real skill-body load completed by `SkillRegistry.get()`: the winning
     * name, source, provider, the real load completion time, and whether the
     * winning candidate came from the collect cache. Log-only: discovery
     * surfaces summaries without bodies, so the load fact and its cache
     * state are not otherwise observable.
     * @param data - the load fact for one validated skill load.
     */
    'skill/loaded': SkillLoadedEventData
  }
}
