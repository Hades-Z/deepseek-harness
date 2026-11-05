/**
 * Runtime helper for the log-only tool-pipeline session events declared in
 * `./types.ts`. Kept out of `types.ts` because that module is types-only (no
 * runtime code, per the package convention). One producer per recording point:
 * the release package is the sole producer of these facts; the external
 * trajectory probe keeps only a call-id → turn/step association index and never
 * writes them.
 * @module @deepseek-ai/dsh-tools
 */
import type { LoggerService } from '@deepseek-ai/cordis'
import type { Session, SessionEventMap } from '@deepseek-ai/dsh-session'

/**
 * The log-only `SessionEventMap` keys this package owns. Narrowed from
 * `SessionEventMap` so `appendToolLogEvent` accepts only its own events and the
 * payload type lines up with the key.
 */
export type ToolLogEventKey =
  | 'tool/catalog-resolved' | 'tool/catalog-exposed' | 'tool/result-attribution'
  | 'tool/execution-plan' | 'tool/result-rewrite' | 'tool/pipeline-error'
  | 'approval/unavailable'

/**
 * Append one log-only tool-pipeline event under failure containment: the event
 * records an already-committed business fact, so a logging failure must never
 * change the surrounding return value or exception. The payload is built inside
 * the guard so a builder fault is contained too.
 * @param logger - the service logger; warns on a failed append.
 * @param session - the owning agent's session; the append target.
 * @param type - one of the log-only `tool/*` keys declared in `./types.ts`.
 * @param build - constructs the payload only when an append will be attempted.
 */
export function appendToolLogEvent<T extends ToolLogEventKey>(
  logger: LoggerService,
  session: Session,
  type: T,
  build: () => SessionEventMap[T],
): void {
  try {
    // The key union is log-only by construction, so the surface-only opts
    // parameter of `Session.append` resolves to an empty tuple for it.
    session.append(type as ToolLogEventKey, build())
  } catch (error: unknown) {
    logger.warn(`tools: ${type} log event failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}
