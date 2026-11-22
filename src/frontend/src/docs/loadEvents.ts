/**
 * `aiui:docs-load`: one structured record per docs request outcome, so a slow
 * or stuck page is visible at once instead of hiding behind the skeleton.
 *
 * Each record goes to `window.__aiuiDocsLoad` (an array, newest last, at most
 * 200), to a `window` CustomEvent named `aiui:docs-load` (detail = the record)
 * and to the console: `console.debug` for answers, `console.warn` for retries,
 * failures and loader mistakes. Trackers and tests read the array. The shape
 * is versioned (`v`); fields are only ever added.
 */

export type DocsLoadOutcome =
    /** The attempt got its answer (2xx, or a 404 / 4xx, which is not retried). */
    | 'ok'
    /** The attempt failed and another one follows. */
    | 'retry'
    /** The last attempt failed: the page shows "Couldn't load" with Retry. */
    | 'failed'
    /** The page's Markdown came inlined in its HTML: no request. */
    | 'inline'
    /** The inlined Markdown is keyed by another URL than the page asks for, so the page fetches anyway. */
    | 'inline-mismatch'
    /** A file already fetched in this document is fetched again (a loader bug). */
    | 'duplicate'

export type DocsLoadReason =
    /** No response headers within the attempt's time limit (stuck connection, or a request held in the browser). */
    | 'headers-timeout'
    /** The body sent nothing for the idle limit. */
    | 'body-idle'
    /** The body took longer than the total limit. */
    | 'body-timeout'
    /** fetch() rejected (offline, DNS, connection reset). */
    | 'network-error'
    /** The server answered 5xx. */
    | 'http-5xx'
    /** The network came back or changed, or the tab woke up, while the attempt waited: a fresh request goes out at once (networkChange.ts). */
    | 'network-change'

export interface DocsLoadEvent {
    v: 1
    type: 'aiui:docs-load'
    /** The app path requested, e.g. `/docs/api/sessions.source.md` (no base path). */
    url: string
    /** `doc` (a page's Markdown) or `manifest` (docs-nav.json, ui-config.json, ...). */
    kind: 'doc' | 'manifest'
    /** 1-based attempt number; 0 for records that are not a request (inline, inline-mismatch). */
    attempt: number
    /** Attempts allowed in all. */
    of: number
    /** Duration of this attempt in ms (0 when not a request). */
    ms: number
    outcome: DocsLoadOutcome
    reason?: DocsLoadReason
    /** HTTP status when there was an answer. */
    status?: number
    /** Extra text for mistakes (e.g. the URL the inlined Markdown was keyed by). */
    detail?: string
    /** performance.now() when recorded. */
    at: number
}

export const DOCS_LOAD_EVENT = 'aiui:docs-load'
const KEEP = 200

type Sink = { __aiuiDocsLoad?: DocsLoadEvent[] } & Partial<Pick<Window, 'dispatchEvent'>>

const LOUD = new Set<DocsLoadOutcome>(['retry', 'failed', 'inline-mismatch', 'duplicate'])

/** Record one outcome (see the module comment for where it goes). Never throws. */
export function recordDocsLoad(event: Omit<DocsLoadEvent, 'v' | 'type' | 'at'>, sink: Sink = globalThis as Sink): DocsLoadEvent {
    const full: DocsLoadEvent = { v: 1, type: DOCS_LOAD_EVENT, ...event, at: Math.round(globalThis.performance?.now?.() ?? 0) }
    try {
        const log = (sink.__aiuiDocsLoad ??= [])
        log.push(full)
        if (log.length > KEEP) log.splice(0, log.length - KEEP)
        if (typeof CustomEvent === 'function' && typeof sink.dispatchEvent === 'function') {
            sink.dispatchEvent(new CustomEvent(DOCS_LOAD_EVENT, { detail: full }))
        }
        if (LOUD.has(full.outcome)) console.warn(DOCS_LOAD_EVENT, full)
        else console.debug(DOCS_LOAD_EVENT, full)
    } catch {
        // a tracker must never break page loading
    }
    return full
}

/** Dev builds only: a loader mistake (duplicate fetch, unused inlined page) as a loud console error. */
export function devAlarm(message: string, event: DocsLoadEvent): void {
    if (import.meta.env?.DEV) console.error(`[aiui docs] ${message}`, event)
}
