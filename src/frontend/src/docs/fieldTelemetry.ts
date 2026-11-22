/**
 * Opt-in field telemetry (`content.docs.telemetry`): the `aiui:docs-load`
 * records (loadEvents.ts) that went wrong, plus a sampled share of the good
 * timings, sent home so a stall in a reader's browser shows up without anyone
 * watching that tab.
 *
 * - Off unless the site opted in; App.tsx imports this chunk only then.
 * - Where: `telemetry.endpoint`, else the aiui server that served the page
 *   (`docsTelemetry.url` in the ui-config.json it serves). A static host with
 *   neither gets no request, not even a probe.
 * - What: only the record's own fields and the page path. No ids, no query
 *   strings or fragments, no user agent; the server keeps no IP address.
 * - When: batched, sent with `navigator.sendBeacon` as the page is hidden or
 *   left. Nothing is sent while the page loads, so `load` never waits on it.
 */
import type { DocsLoadEvent } from './loadEvents'

/** loadEvents.ts DOCS_LOAD_EVENT, repeated so this chunk imports nothing at run time (a value import would pull the docs app into a shared chunk). */
const DOCS_LOAD_EVENT = 'aiui:docs-load'

export interface TelemetryConfig {
    endpoint?: string
    /** Share of `ok` records sent for timings (0-1, default 0.1). Problems are always sent. */
    sampleRate?: number
}

/** One record as sent: the load record's fields, the page path, and whether it was sampled. */
export interface FieldRecord {
    url: string
    kind: DocsLoadEvent['kind']
    attempt: number
    of: number
    ms: number
    outcome: DocsLoadEvent['outcome']
    reason?: string
    status?: number
    detail?: string
    page?: string
    sampled?: boolean
}

/** Records per beacon (the server takes 50) and held at most between sends. */
export const BATCH = 50
export const HOLD = 200
export const DEFAULT_SAMPLE_RATE = 0.1

/** Where records go, or null (send nothing). */
export function telemetryTarget(cfg: TelemetryConfig | undefined | null, server?: string | null): string | null {
    if (!cfg) return null
    return cfg.endpoint || server || null
}

const noQuery = (path: string) => path.split(/[?#]/)[0]

/** The record to send, or null: problems always, `ok` at the sample rate, inline never (no timing). */
export function fieldRecord(e: DocsLoadEvent, rate: number, page: string, random: () => number = Math.random): FieldRecord | null {
    if (!e || e.type !== DOCS_LOAD_EVENT || typeof e.url !== 'string') return null
    if (e.outcome === 'inline') return null
    const sampled = e.outcome === 'ok'
    if (sampled && !(random() < rate)) return null
    return {
        url: noQuery(e.url), kind: e.kind, attempt: e.attempt, of: e.of, ms: Math.round(e.ms), outcome: e.outcome,
        ...(e.reason ? { reason: e.reason } : {}),
        ...(typeof e.status === 'number' ? { status: e.status } : {}),
        ...(e.detail ? { detail: noQuery(e.detail).slice(0, 200) } : {}),
        page: noQuery(page),
        ...(sampled ? { sampled: true } : {}),
    }
}

export interface TelemetryEnv {
    win: Pick<Window, 'addEventListener' | 'removeEventListener'> & { __aiuiDocsLoad?: DocsLoadEvent[] }
    doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
    beacon: (url: string, body: string) => boolean
    page: () => string
    random?: () => number
}

/**
 * Collect records (those already recorded, then each new one) and send them
 * when the page is hidden. Returns the uninstaller.
 */
export function installFieldTelemetry(target: string, cfg: TelemetryConfig, env: TelemetryEnv): () => void {
    const rate = typeof cfg.sampleRate === 'number' ? Math.min(1, Math.max(0, cfg.sampleRate)) : DEFAULT_SAMPLE_RATE
    const queue: FieldRecord[] = []
    const add = (e: DocsLoadEvent) => {
        const rec = fieldRecord(e, rate, env.page(), env.random)
        if (rec && queue.length < HOLD) queue.push(rec)
    }
    for (const e of env.win.__aiuiDocsLoad ?? []) add(e)
    const onRecord = (e: Event) => add((e as CustomEvent<DocsLoadEvent>).detail)
    const flush = () => {
        while (queue.length) {
            const batch = queue.splice(0, BATCH)
            try {
                if (!env.beacon(target, JSON.stringify({ v: 1, records: batch }))) break
            } catch {
                break // a tracker must never break the page
            }
        }
    }
    const onHide = () => { if (env.doc.visibilityState === 'hidden') flush() }
    env.win.addEventListener(DOCS_LOAD_EVENT, onRecord)
    env.win.addEventListener('pagehide', flush)
    env.doc.addEventListener('visibilitychange', onHide)
    return () => {
        env.win.removeEventListener(DOCS_LOAD_EVENT, onRecord)
        env.win.removeEventListener('pagehide', flush)
        env.doc.removeEventListener('visibilitychange', onHide)
    }
}

let started = false

/** App.tsx: start sending (once per page) when the site opted in and there is somewhere to send to. */
export function startFieldTelemetry(cfg: TelemetryConfig | undefined, server: string | undefined, page: () => string): () => void {
    const target = telemetryTarget(cfg, server)
    if (started || !cfg || !target || typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return () => {}
    started = true
    // A string body is sent as text/plain: no CORS preflight for another origin.
    return installFieldTelemetry(target, cfg, {
        win: window, doc: document, page,
        beacon: (url, body) => navigator.sendBeacon(url, body),
    })
}
