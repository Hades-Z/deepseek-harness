/**
 * Vocabulary for the web capability seam (`ctx.web`). Search and fetch deliberately share one
 * seam so provider selection, cancellation, errors, and product configuration have one owner,
 * while retaining separate request and result types.
 * @module @deepseek-ai/dsh-web/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/**
 * What one search-capable backend is asked to search. Each request carries one
 * query; a consumer may issue several requests. `maxResults` is a
 * `dsh-tool-web`-layer bound passed through unchanged and enforced on the way
 * back by the seam (see {@link WebSearchResult}).
 */
export interface WebSearchRequest {
  readonly query: string
  /**
   * Upper bound on returned sources; the seam truncates to it. Omitted = no
   * bound. `dsh-tool-web` always sets it. A provider whose API supports a
   * result-count control (Exa's `numResults`) should apply it at the request
   * layer as a cost/latency optimization; the seam enforces the bound
   * regardless.
   */
  readonly maxResults?: number
}

/**
 * Normalized search outcome. `content` is optional provider-generated answer
 * text or summary (Exa and DeepSeek return none; Perplexity returns a
 * generated answer).
 * `sources[]` is the portable citation shape. `truncated` is set by the seam
 * when it cut `sources[]` down to `maxResults`.
 */
export interface WebSearchResult {
  /** Optional provider-generated answer text, search context, or summary. */
  readonly content?: string
  /** Citeable sources, already truncated to the request's `maxResults`. */
  readonly sources: readonly WebSearchSource[]
  /** True when the seam dropped sources to honor `maxResults`. */
  readonly truncated: boolean
}

/**
 * One citeable source. A source always has a URL; `title`, `snippet`, `summary`,
 * and `publishedAt` are optional because not every provider returns them — forcing
 * adapters to invent them would make the seam lie (Perplexity citations may be
 * URL-only). `dsh-tool-web` renders `title ?? hostname(url)` for display.
 */
export interface WebSearchSource {
  readonly url: string
  readonly title?: string
  /** Short excerpt suited to display. */
  readonly snippet?: string
  /** Longer excerpt suited to model reading; consumers bound its length. */
  readonly summary?: string
  /** Publication/crawl timestamp as a provider-supplied ISO-8601 string. */
  readonly publishedAt?: string
}

/**
 * What one fetch-capable backend is asked to retrieve. The request deliberately
 * omits timeout, format, prompt, and extraction controls: cancellation is a
 * direct execution argument, while presentation and higher-level LLM concerns
 * belong outside safe retrieval.
 */
export interface WebFetchRequest {
  readonly url: string
}

/**
 * Normalized fetch outcome. A successful network fetch of a non-2xx response is
 * a result, not an error: the status code is part of the fetched resource
 * state. {@link WebError} is reserved for failures to safely retrieve or
 * represent the resource.
 */
export interface WebFetchResult {
  /** The final URL after allowed redirects (the request URL is in the request). */
  readonly url: string
  /** HTTP status code of the fetched response. */
  readonly statusCode: number
  /** Decoded body, classified by content kind. */
  readonly body: WebFetchBody
  /** True when the provider capped the decoded body. */
  readonly truncated: boolean
}

/**
 * The decoded body of a fetched resource. A CLOSED discriminated union owned by
 * `dsh-web`: the provider decodes the kind and `dsh-tool-web` renders it, so a
 * new kind is a coordinated change across known packages, not a plugin
 * extension. Consumers `switch` on `kind` ending in `default: assertNever(...)`
 * so adding a kind breaks compilation at every consumer until handled. Each arm
 * stays its own object literal even where fields coincide, so an arm can gain
 * fields the others lack.
 */
export type WebFetchBody =
  | { readonly kind: 'html'; readonly content: string }
  | { readonly kind: 'text'; readonly content: string }

/**
 * A search-capable backend. Registered with `ctx.web.registerSearchProvider`.
 * `id` is a stable string, unique within the search capability kind.
 */
export interface WebSearchProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
  /**
   * Whether a search made for a model request on the `llmProvider` chat route has a
   * credential to send. Checks configuration only and must not make network calls.
   * Omitted = ready.
   * @param llmProvider - the provider route id of the model request, when known.
   * @returns false when that request's searches could not authenticate.
   */
  ready?(llmProvider: string | undefined): Promise<boolean>
  /** Run one search; honor `signal` for cancellation. */
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
}

/**
 * A fetch-capable backend. Registered with `ctx.web.registerFetchProvider`.
 * `id` is a stable string, unique within the fetch capability kind.
 */
export interface WebFetchProvider {
  readonly id: string
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
  /**
   * Whether a fetch made for a model request on the `llmProvider` chat route has a
   * credential to send. Checks configuration only and must not make network calls.
   * Omitted = ready.
   * @param llmProvider - the provider route id of the model request, when known.
   * @returns false when that request's fetches could not authenticate.
   */
  ready?(llmProvider: string | undefined): Promise<boolean>
  /** Retrieve one URL; honor `signal` for cancellation. */
  fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>
}

/**
 * Typed web error with a machine-routable, open-string `code` and chained `cause`.
 * Consumers must tolerate provider-specific codes. Shared codes cover unavailable,
 * missing, unusable, ambiguous, or duplicate providers, cancellation, and provider failure;
 * the local fetch provider additionally distinguishes invalid or blocked URLs, redirects,
 * size and timeout limits, and unsupported content types. Tool execution exposes the code in
 * structured error metadata.
 */
export class WebError extends HarnessError {}

/**
 * How a provider won selection for the shared `tool/provider-selected` recording point. Web
 * operations select by configuration or as the sole usable provider; an lsp query routes by file
 * extension.
 */
export type ToolProviderSelectionMode = 'configured' | 'auto-single' | 'extension-route'

/** The capability whose provider selection the shared `tool/provider-selected` event records. */
export type ToolProviderSelectedCapability = 'web-search' | 'web-fetch' | 'lsp'

/**
 * Durable payload for `tool/provider-selected`: which provider one capability operation resolved
 * to, and how. Selection is a private seam concern — `resolveProvider` and the lsp route table are
 * not public — so the trajectory probe cannot see it; this records the real selection after it
 * succeeds. A failed selection (missing, unavailable, ambiguous, no route) throws the seam's
 * structured error and appends nothing: no selection fact exists to record. `turn`/`step` are
 * absent: the trajectory probe joins them from its call-id → turn/step association index.
 * This module owns the payload; `@deepseek-ai/dsh-web` produces the web-search and web-fetch
 * events and `@deepseek-ai/dsh-lsp` the lsp event, each under its own capability.
 */
export interface ToolProviderSelectedEventData {
  /** The owning agent's session id. The event is written only when an initiator agent owns a session. */
  readonly sessionId: string
  /** The operation that resolved a provider. */
  readonly capability: ToolProviderSelectedCapability
  /** Registry id of the provider the selection resolved to. */
  readonly providerId: string
  /** How the provider won: explicit configuration, sole usable registration, or extension route. */
  readonly selectionMode: ToolProviderSelectionMode
}

/**
 * Durable payload for `web/search-route`: the single route one `WebRuntime.search()` call took.
 * The seam has no fallback chain — one selection, one provider call — so the event records that
 * one route's provider, selection mode, real elapsed time, and outcome, not a chain. `elapsedMs`
 * measures the selected provider's `search()` call only (monotonic clock), not selection or result
 * capping; `outcome` is `error` when the provider call threw, whose structured failure still
 * propagates unchanged. `turn`/`step` are absent: the trajectory probe joins them from its
 * call-id → turn/step association index.
 */
export interface WebSearchRouteEventData {
  /** The owning agent's session id. The event is written only when an initiator agent owns a session. */
  readonly sessionId: string
  /** Registry id of the provider the search ran through. */
  readonly providerId: string
  /** How the provider won selection: explicit configuration or sole usable registration. */
  readonly selectionMode: Exclude<ToolProviderSelectionMode, 'extension-route'>
  /** Real elapsed milliseconds of the selected provider's `search()` call, from a monotonic clock. */
  readonly elapsedMs: number
  /** Whether the provider call resolved (`ok`) or threw (`error`). */
  readonly outcome: 'ok' | 'error'
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The provider one capability operation resolved to, with the selection mode. Log-only:
     * provider selection is private to the web and lsp seams. One event per resolved selection;
     * failed selections record nothing.
     * @param data - the real selection fact for one operation.
     */
    'tool/provider-selected': ToolProviderSelectedEventData
    /**
     * The single route one web search took: provider, selection mode, real elapsed time, and
     * outcome. Log-only: the seam has no fallback chain, and the probe sees only the tool result,
     * not which provider served it or how the route took.
     * @param data - the route fact for one search call.
     */
    'web/search-route': WebSearchRouteEventData
  }
}
