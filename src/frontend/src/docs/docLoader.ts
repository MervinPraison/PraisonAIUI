/**
 * Docs markdown loading: bounded attempts, retry, an in-memory cache and
 * prefetch.
 *
 * One slow connection must not freeze the page. A request that opens a new
 * TCP/TLS connection over a lossy network can sit in connection setup for
 * 15-20 s (lost handshake packets back off 1 s, 2 s, 4 s, 8 s) while a fresh
 * request usually gets through at once. So each attempt has a time limit for
 * the response headers; past it the attempt is aborted (which also cancels
 * its stalled connection attempt) and a new request goes out.
 *
 * Why 5 s: a docs page is one small file from the same origin. On a slow 3G
 * link (400 ms RTT, 400 kbit/s) a request on a new TLS connection has its
 * headers in about 2 s, so 5 s only fires after two or three lost packets in
 * a row, when starting over is faster than waiting. The last attempt allows
 * 10 s so a link that is merely very slow still gets the page.
 *
 * The body has two limits of its own. A body that sends nothing for 4 s has
 * stalled (a dropped connection the browser has not noticed) and is cut off
 * and requested again; a body that keeps arriving, however slowly, gets up to
 * 15 s in all. So a stall costs 4 s, not 15, and no attempt waits for ever.
 *
 * Markdown is requested with `cache: 'no-store'`, and every retry is too.
 * Chrome's HTTP cache lets one request per URL at a time write the cache
 * entry; a second request for the same URL (another tab, an older copy of the
 * app, a background tab whose timers are throttled) waits inside the browser
 * until the first one has its answer (net log: HTTP_CACHE_ADD_TO_ENTRY). One
 * stuck peer used to hold every attempt here for its whole stall; a no-store
 * request skips the cache entry, so it can neither wait on a peer nor hold
 * one. The CDN still caches, and this module keeps its own in-memory cache.
 *
 * A retry also moves to a fresh connection. Some networks drop a TCP
 * connection that sat idle for 15-30 s without telling either end (seen on a
 * home router over IPv6). The browser keeps its one HTTP/2 connection to the
 * site, sends the next request down the dead one and waits; aborting the
 * request does not close that connection, so every retry on it hangs too.
 * Chrome keeps requests without credentials on a separate connection pool,
 * so attempts alternate between `credentials: 'same-origin'` and `'omit'`, and
 * later requests start on whichever pool last answered. A server that wants
 * its cookie for Markdown (auth on) answers an `omit` attempt with 401/403:
 * that attempt is repeated with credentials and `omit` is not used again.
 *
 * Waiting for a timeout to find out is too slow, so an attempt is hedged:
 * no response headers after HEDGE_MS (HEDGE_AFTER_IDLE_MS when nothing was
 * fetched for IDLE_RISK_MS, the case where connections die) and the same
 * request goes out on the other pool; the first answer wins and the other is
 * cancelled. A request that fails outright moves to the other pool at once.
 * And a visitor coming back after IDLE_RISK_MS without input (pointer, key,
 * touch, the tab shown again) sends one tiny request (`ui-config.json`) the
 * same way, so the pool that works is known before the click.
 * `python -m preqa netfault` reproduces the dead connection.
 *
 * Every outcome is recorded as an `aiui:docs-load` event (loadEvents.ts).
 */
import { docPathToSource, normalizeDocPath } from '../pathUtils'
import { canonicalDocPath, stripHtmlSuffix } from './docSource'
import { appPathname, stripBase, withBase } from '../lib/url'
import { devAlarm, recordDocsLoad, type DocsLoadReason } from './loadEvents'
import { afterLoad } from './afterLoad'
import { onNetworkChange } from './networkChange'

export interface DocResult {
    ok: boolean
    status: number
    text: string
}

/** Time to response headers, per attempt (initial request + 2 retries): a held request shows as "retrying" after 3 s. */
export const ATTEMPT_TIMEOUTS_MS = [3_000, 5_000, 8_000]
/** Time to read the body once the headers are in. */
export const BODY_TIMEOUT_MS = 15_000
/** Time the body may go without a byte before the attempt counts as stalled. */
export const BODY_IDLE_TIMEOUT_MS = 4_000
const CACHE_LIMIT = 100
const PREFETCH_LIMIT = 4
const HOVER_DELAY_MS = 80

export class DocLoadError extends Error {
    constructor(url: string, cause: unknown) {
        super(`Could not load ${url}`, { cause })
        this.name = 'DocLoadError'
    }
}

/** Page time in whole ms. */
const now = () => Math.round(globalThis.performance?.now?.() ?? Date.now())

const abortError = () => new DOMException('Aborted', 'AbortError')

/** Resolves after `ms`; rejects with AbortError if `signal` aborts first. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(abortError())
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
        }, ms)
        const onAbort = () => {
            clearTimeout(timer)
            reject(abortError())
        }
        signal?.addEventListener('abort', onAbort, { once: true })
    })
}

/** AbortSignal.any where the browser has it (Chrome 116, Safari 17.4, Firefox 124). */
function anySignal(signals: AbortSignal[]): AbortSignal {
    if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals)
    const controller = new AbortController()
    for (const s of signals) {
        if (s.aborted) {
            controller.abort(s.reason)
            break
        }
        s.addEventListener('abort', () => controller.abort(s.reason), { once: true })
    }
    return controller.signal
}

/** A promise that rejects with the signal's reason once it aborts (never resolves). */
function whenAborted(signal: AbortSignal): Promise<never> {
    const p = new Promise<never>((_resolve, reject) => {
        const fail = () => reject(signal.reason ?? abortError())
        if (signal.aborted) fail()
        else signal.addEventListener('abort', fail, { once: true })
    })
    p.catch(() => {}) // observed through Promise.race; never an unhandled rejection
    return p
}

/**
 * The body as text, read chunk by chunk so `onBytes` sees every chunk arrive
 * (the idle limit). Aborting `signal` cancels the stream. Without a readable
 * body (an old browser, a test double) it falls back to `response.text()`.
 */
async function readText(response: Response, onBytes: () => void, signal: AbortSignal): Promise<string> {
    const reader = response.body?.getReader()
    if (!reader) return response.text()
    const cancel = () => void reader.cancel(signal.reason).catch(() => {})
    signal.addEventListener('abort', cancel, { once: true })
    const decoder = new TextDecoder()
    let text = ''
    try {
        for (;;) {
            const { done, value } = await reader.read()
            // A cancelled stream ends "done": never hand back a cut-off page as a whole one.
            if (signal.aborted) throw signal.reason ?? abortError()
            if (done) return text + decoder.decode()
            onBytes()
            text += decoder.decode(value, { stream: true })
        }
    } finally {
        signal.removeEventListener('abort', cancel)
    }
}

export interface RetryOptions {
    signal?: AbortSignal
    timeouts?: number[]
    bodyTimeoutMs?: number
    bodyIdleTimeoutMs?: number
    fetchImpl?: typeof fetch
    /** Pause before a retry (default 100-400 ms of jitter). */
    backoff?: (attempt: number) => number
    /** HTTP cache mode of the first attempt (default 'default'); retries are always 'no-store'. */
    cache?: RequestCache
    /** What is loaded, for the `aiui:docs-load` record (default 'doc'). */
    kind?: 'doc' | 'manifest'
    /** Called as each attempt starts (1-based), e.g. to show "retrying". */
    onAttempt?: (attempt: number, of: number) => void
    /** Hears network changes (default networkChange.ts); returns the remover. */
    watchNetwork?: (onChange: () => void) => () => void
    /** Hedge delay (default hedgeDelay(): HEDGE_MS, or HEDGE_AFTER_IDLE_MS after an idle spell). */
    hedgeMs?: number
}

/** Credentials of the attempt that last got an answer: later requests start there (see top). */
let leadCredentials: RequestCredentials = 'same-origin'
/** True once the server answered an `omit` attempt with 401/403: it needs its cookie. */
let omitRefused = false

/** Credentials for `attempt` (0-based): alternate pools, starting from the one that last answered. */
export function credentialsFor(attempt: number): RequestCredentials {
    if (omitRefused) return 'same-origin'
    const other: RequestCredentials = leadCredentials === 'omit' ? 'same-origin' : 'omit'
    return attempt % 2 === 0 ? leadCredentials : other
}

/** Test hook: forget which pool answered last. */
export function resetConnectionPools(): void {
    leadCredentials = 'same-origin'
    omitRefused = false
    lastAnswerAt = now()
}

/** No headers after this long: the same request also goes out on the other pool. */
export const HEDGE_MS = 1_000
/** The hedge delay when nothing came back for IDLE_RISK_MS (a connection may have died idle). */
export const HEDGE_AFTER_IDLE_MS = 400
/** Idle this long and a connection may be dead (routers seen dropping them after 15-30 s). */
export const IDLE_RISK_MS = 10_000
/** When any request last got response headers (page time). The page itself just loaded. */
let lastAnswerAt = now()

const otherPool = (c: RequestCredentials): RequestCredentials | null =>
    omitRefused ? null : c === 'omit' ? 'same-origin' : 'omit'

/** The hedge delay for a request starting now. */
export function hedgeDelay(): number {
    return now() - lastAnswerAt > IDLE_RISK_MS ? HEDGE_AFTER_IDLE_MS : HEDGE_MS
}

interface Leg {
    response: Response
    credentials: RequestCredentials
}

/**
 * GET on the `lead` pool; no headers after `delayMs` (or a network error) and
 * the same request also goes out on the `alt` pool. The first response wins and
 * the other request is aborted. A 401/403 to an `omit` request marks the pool
 * refused and waits for the other request if one is out. Aborting `signal`
 * aborts both.
 */
function hedgedFetch(href: string, init: RequestInit, lead: RequestCredentials, alt: RequestCredentials | null,
    delayMs: number, fetchImpl: typeof fetch, signal: AbortSignal): Promise<Leg> {
    return new Promise<Leg>((resolve, reject) => {
        const legs: AbortController[] = []
        let pending = 0
        let done = false
        let timer: ReturnType<typeof setTimeout> | undefined
        const finish = () => {
            done = true
            clearTimeout(timer)
            signal.removeEventListener('abort', onAbort)
        }
        const onAbort = () => {
            if (done) return
            finish()
            for (const c of legs) c.abort(signal.reason)
            reject(signal.reason ?? abortError())
        }
        if (signal.aborted) return reject(signal.reason ?? abortError())
        signal.addEventListener('abort', onAbort, { once: true })
        const start = (credentials: RequestCredentials) => {
            const own = new AbortController()
            legs.push(own)
            pending++
            fetchImpl(href, { ...init, credentials, signal: anySignal([signal, own.signal]) }).then((response) => {
                pending--
                if (done) return
                lastAnswerAt = now()
                if (credentials === 'omit' && (response.status === 401 || response.status === 403)) {
                    omitRefused = true
                    leadCredentials = 'same-origin'
                    if (pending > 0) return // the credentialed request is out: its answer counts
                }
                finish()
                for (const c of legs) if (c !== own) c.abort(abortError())
                resolve({ response, credentials })
            }, (error: unknown) => {
                pending--
                if (done) return
                const other = otherPool(credentials)
                if (pending === 0 && legs.length < 2 && other) {
                    clearTimeout(timer)
                    start(other) // failed outright: the other pool at once, no waiting
                } else if (pending === 0) {
                    finish()
                    reject(error)
                }
            })
        }
        start(lead)
        if (alt) timer = setTimeout(() => { if (!done && legs.length < 2) start(alt) }, delayMs)
    })
}

/** An attempt waiting at least this long when the network changes is replaced by a fresh request. */
export const NETWORK_CHANGE_MIN_MS = 500

/**
 * GET `url` (an app path such as `/docs/x.md`: the site's base path is added
 * here, lib/url.ts) with a time limit per attempt and a fresh request after each
 * timeout, network error or 5xx. 2xx and 4xx are answers (no retry). Aborting
 * `signal` stops at once with an AbortError. All attempts failed: DocLoadError.
 */
export async function fetchWithRetry(url: string, opts: RetryOptions = {}): Promise<DocResult> {
    const {
        signal = new AbortController().signal,
        timeouts = ATTEMPT_TIMEOUTS_MS,
        bodyTimeoutMs = BODY_TIMEOUT_MS,
        bodyIdleTimeoutMs = BODY_IDLE_TIMEOUT_MS,
        fetchImpl = (...args) => fetch(...args),
        backoff = () => 100 + Math.random() * 300,
        cache = 'default',
        kind = 'doc',
        onAttempt,
        watchNetwork = onNetworkChange,
        hedgeMs,
    } = opts
    let lastError: unknown = null
    const of = timeouts.length
    for (let attempt = 0; attempt < of; attempt++) {
        if (signal.aborted) throw abortError()
        onAttempt?.(attempt + 1, of)
        const started = now()
        // One controller per attempt: a time limit (headers, then body) aborts
        // this request, which also cancels its stalled connection or body.
        const request = new AbortController()
        let reason: DocsLoadReason = 'headers-timeout'
        const timeoutFor = (why: DocsLoadReason) => () => {
            reason = why
            request.abort(new DOMException('Timed out', 'TimeoutError'))
        }
        let timer = setTimeout(timeoutFor('headers-timeout'), timeouts[attempt])
        // A dead shared connection holds this attempt until its limit; after a network change a
        // new request gets a new connection, so end this one now (never the last attempt).
        const unwatch = attempt < of - 1
            ? watchNetwork(() => { if (now() - started >= NETWORK_CHANGE_MIN_MS) timeoutFor('network-change')() })
            : () => {}
        let idle: ReturnType<typeof setTimeout> | undefined
        const s = anySignal([signal, request.signal])
        // Raced, not only passed to fetch: a body that stalls after the headers
        // would otherwise leave response.text() pending for ever.
        const aborted = whenAborted(s)
        let status: number | undefined
        try {
            // A retry never goes through the HTTP cache: it must not queue behind a peer (see top).
            // A retry also uses the other connection pool: the last one may be dead (see top).
            const lead = credentialsFor(attempt)
            const init: RequestInit = { cache: attempt === 0 ? cache : 'no-store' }
            const { response, credentials } = await Promise.race([
                hedgedFetch(withBase(url), init, lead, otherPool(lead), hedgeMs ?? hedgeDelay(), fetchImpl, s), aborted])
            clearTimeout(timer)
            status = response.status
            if (credentials === 'omit' && (status === 401 || status === 403)) {
                // The server wants its cookie: ask again with it, at once, and never omit again.
                omitRefused = true
                leadCredentials = 'same-origin'
                attempt--
                continue
            }
            if (response.status < 500) {
                leadCredentials = credentials
                timer = setTimeout(timeoutFor('body-timeout'), bodyTimeoutMs)
                // Each chunk restarts the idle limit; the total limit keeps running.
                const progress = () => {
                    clearTimeout(idle)
                    idle = setTimeout(timeoutFor('body-idle'), bodyIdleTimeoutMs)
                }
                progress()
                const text = response.ok ? await Promise.race([readText(response, progress, s), aborted]) : ''
                recordDocsLoad({ url, kind, attempt: attempt + 1, of, ms: now() - started, outcome: 'ok', status })
                return { ok: response.ok, status: response.status, text }
            }
            reason = 'http-5xx'
            lastError = new Error(`HTTP ${response.status}`)
        } catch (e) {
            if (signal.aborted) throw abortError()
            if (!request.signal.aborted) reason = 'network-error'
            lastError = e
        } finally {
            clearTimeout(timer)
            clearTimeout(idle)
            unwatch()
        }
        const last = attempt === of - 1
        recordDocsLoad({ url, kind, attempt: attempt + 1, of, ms: now() - started, outcome: last ? 'failed' : 'retry', reason, status })
        if (!last) await sleep(backoff(attempt), signal)
    }
    throw new DocLoadError(url, lastError)
}


// ── Cache and shared requests ─────────────────────────────────────────────

interface Flight {
    promise: Promise<DocResult>
    controller: AbortController
    /** Navigations waiting on it. */
    waiters: number
    /** Started by a prefetch and not yet wanted by a navigation: let it finish. */
    prefetch: boolean
    /** The attempt running now (1-based) and how many there may be. */
    attempt: number
    of: number
    /** Navigations to tell when a retry starts. */
    onAttempt: Set<(attempt: number, of: number) => void>
}

const cache = new Map<string, DocResult>()
const flights = new Map<string, Flight>()
/** Files this document has already fetched successfully (a second fetch is a loader bug, or the cache overflowed). */
const fetched = new Set<string>()

function remember(url: string, result: DocResult) {
    cache.delete(url)
    cache.set(url, result)
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
}

function startFlight(url: string, prefetch: boolean): Flight {
    const controller = new AbortController()
    const flight: Flight = {
        controller, waiters: 0, prefetch, attempt: 0, of: 0, onAttempt: new Set(),
        promise: Promise.resolve(null as unknown as DocResult),
    }
    if (fetched.has(url)) {
        devAlarm(`fetching ${url} again in this page`, recordDocsLoad({ url, kind: 'doc', attempt: 0, of: 0, ms: 0, outcome: 'duplicate' }))
    }
    const onAttempt = (attempt: number, of: number) => {
        flight.attempt = attempt
        flight.of = of
        for (const listener of flight.onAttempt) listener(attempt, of)
    }
    flight.promise = fetchWithRetry(url, { signal: controller.signal, cache: 'no-store', onAttempt }).then(
        (result) => {
            // 2xx and 404 are stable answers; other 4xx may be transient (auth, rate limit).
            if (result.ok || result.status === 404) remember(url, result)
            if (result.ok) fetched.add(url)
            return result
        },
    ).finally(() => {
        if (flights.get(url) === flight) flights.delete(url)
    })
    flight.promise.catch(() => {}) // a prefetch nobody waits on must not log an unhandled rejection
    flights.set(url, flight)
    return flight
}

/** The cached answer for `url`, if any (a cached page renders without waiting). */
export function peekDoc(url: string): DocResult | undefined {
    return cache.get(url)
}

/**
 * Load a docs markdown file for a navigation. Joins a prefetch already in
 * flight. Aborting `signal` (the next click) rejects with AbortError and
 * cancels the request once no other navigation waits on it, so rapid clicks
 * never queue requests: the last click wins. `onRetry` hears each retry
 * (attempt 2 and up, at once if the joined request is already retrying), so
 * the page can say it is still trying instead of showing a silent skeleton.
 */
export function loadDoc(url: string, signal: AbortSignal, onRetry?: (attempt: number, of: number) => void): Promise<DocResult> {
    const hit = cache.get(url)
    if (hit) return Promise.resolve(hit)
    if (signal.aborted) return Promise.reject(abortError())
    const flight = flights.get(url) ?? startFlight(url, false)
    flight.waiters += 1
    flight.prefetch = false
    const listener = onRetry && ((attempt: number, of: number) => { if (attempt > 1) onRetry(attempt, of) })
    if (listener) {
        flight.onAttempt.add(listener)
        listener(flight.attempt, flight.of)
    }
    return new Promise<DocResult>((resolve, reject) => {
        const onAbort = () => {
            if (listener) flight.onAttempt.delete(listener)
            flight.waiters -= 1
            if (flight.waiters === 0 && !flight.prefetch) {
                flight.controller.abort()
                if (flights.get(url) === flight) flights.delete(url)
            }
            reject(abortError())
        }
        signal.addEventListener('abort', onAbort, { once: true })
        const done = () => {
            signal.removeEventListener('abort', onAbort)
            if (listener) flight.onAttempt.delete(listener)
        }
        flight.promise.then(
            (r) => {
                done()
                resolve(r)
            },
            (e) => {
                done()
                reject(e)
            },
        )
    })
}

/** Warm the cache for `url` (hover, focus, next/previous page). Never rejects. */
export function prefetchDoc(url: string): void {
    if (cache.has(url) || flights.has(url)) return
    let running = 0
    for (const f of flights.values()) if (f.prefetch) running += 1
    if (running >= PREFETCH_LIMIT) return
    startFlight(url, true)
}

/** The JSON script `aiui build` writes into each docs page: `{"url": "/docs/x.md", "text": "..."}`. */
export const INITIAL_DOC_ID = 'aiui-initial-doc'

interface InlinedDocSource {
    getElementById(id: string): { textContent: string | null; remove(): void } | null
}

/**
 * Seed the cache with the page's own markdown, inlined in its HTML by `aiui
 * build`, so the first render needs no request. Read once (the element is
 * removed); a missing or malformed block changes nothing and the page loads
 * its markdown as before. Returns the URL it seeded, or null.
 */
export function adoptInlinedDoc(root: InlinedDocSource | undefined = typeof document === 'undefined' ? undefined : document): string | null {
    const el = root?.getElementById(INITIAL_DOC_ID)
    if (!el) return null
    el.remove()
    try {
        const data = JSON.parse(el.textContent ?? '') as { url?: unknown; text?: unknown }
        if (typeof data.url !== 'string' || typeof data.text !== 'string' || !data.url.endsWith('.md')) return null
        remember(data.url, { ok: true, status: 200, text: data.text })
        recordDocsLoad({ url: data.url, kind: 'doc', attempt: 0, of: 0, ms: 0, outcome: 'inline' })
        return data.url
    } catch {
        return null
    }
}

/** The JSON script `aiui build` writes into each page: `{"/docs-nav.json": {...}, "/route-manifest.json": {...}}`. */
export const BOOT_DATA_ID = 'aiui-boot-data'

const bootData = new WeakMap<object, Record<string, unknown>>()

/**
 * A site manifest `aiui build` inlined in the page (compiler/boot_data.py), so
 * the first render needs no request for it; undefined when the page has none
 * (a server, an older build, a docs-auth site's nav, a file too big to inline)
 * and the caller fetches it as before. The block stays in the page: the legacy
 * nav-intercept plugin reads the nav from it too.
 */
export function inlinedManifest(
    url: string,
    root: InlinedDocSource | undefined = typeof document === 'undefined' ? undefined : document,
): unknown {
    const el = root?.getElementById(BOOT_DATA_ID)
    if (!el) return undefined
    let data = bootData.get(el)
    if (!data) {
        try {
            const parsed: unknown = JSON.parse(el.textContent ?? '')
            data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
        } catch {
            data = {}
        }
        bootData.set(el, data)
    }
    return Object.hasOwn(data, url) ? data[url] : undefined
}

/**
 * On a deep link under the docs base, start loading that page's markdown
 * while the app is still fetching its manifests, instead of one round trip
 * after them. Content.tsx then joins this request (or finds it cached). The
 * site root is skipped: in the chat and agents styles `/` is not a docs page.
 */
export function prefetchInitialDoc(pathname = appPathname(), base = '/docs', root?: InlinedDocSource): string | null {
    const inlined = adoptInlinedDoc(root) // the page's markdown inlined by `aiui build`: no request at all
    const path = normalizeDocPath(pathname)
    if (path !== base && !path.startsWith(`${base}/`)) return null
    const url = docPathToSource(canonicalDocPath(path, base))
    if (inlined && inlined !== url) {
        // The build keyed the page's Markdown by another URL: it is fetched anyway (aiui build --strict catches this).
        const event = recordDocsLoad({ url, kind: 'doc', attempt: 0, of: 0, ms: 0, outcome: 'inline-mismatch', detail: `inlined as ${inlined}` })
        devAlarm(`the page's inlined Markdown (${inlined}) is not the file it loads (${url})`, event)
    }
    prefetchDoc(url)
    return url
}

/** Test hook: forget every cached answer and cancel every request. */
export function resetDocCache(): void {
    resetConnectionPools()
    for (const f of flights.values()) f.controller.abort()
    flights.clear()
    cache.clear()
    fetched.clear()
}

// ── Link prefetch ──────────────────────────────────────────────────────────

/** Links whose target is a docs page: sidebar, previous / next, in-article links. */
const DOC_LINK = 'a[data-nav-path], a.aiui-docs-pager-link, #main-content article a[href]'

/** The markdown URL a same-origin docs href points at, or null. */
export function docHrefMarkdownUrl(href: string, pageUrl: string, base = '/docs'): string | null {
    let url: URL
    try {
        url = new URL(href, pageUrl)
    } catch {
        return null
    }
    if (url.origin !== new URL(pageUrl).origin) return null
    // A page's .html file URL names the page (docSource.ts stripHtmlSuffix).
    const path = normalizeDocPath(stripHtmlSuffix(stripBase(url.pathname)))
    if (path !== '/' && !path.startsWith(`${base}/`)) return null
    const last = path.split('/').pop() || ''
    if (last.includes('.') && !last.endsWith('.md')) return null // assets, images
    return docPathToSource(path.replace(/\.md$/, ''))
}

function linkMarkdownUrl(anchor: HTMLAnchorElement): string | null {
    if (anchor.target && anchor.target !== '_self') return null
    return docHrefMarkdownUrl(anchor.getAttribute('href') || '', window.location.href)
}

/**
 * Prefetch a docs link's markdown when the pointer rests on it (80 ms, so a
 * sweep down the sidebar fetches nothing), on keyboard focus and at once on
 * pointerdown (about 100 ms before the click). Returns the uninstaller.
 */
export function installDocPrefetch(root: Document = document): () => void {
    let hoverTimer: ReturnType<typeof setTimeout> | undefined
    let hovered: Element | null = null
    const linkOf = (target: EventTarget | null) =>
        target instanceof Element ? target.closest<HTMLAnchorElement>(DOC_LINK) : null
    const warm = (a: HTMLAnchorElement | null) => {
        const url = a && linkMarkdownUrl(a)
        if (url) prefetchDoc(url)
    }
    // Hover and focus are guesses: not while the page is still loading (`load` would wait on them).
    // A pointerdown is a click on its way, so it warms at once.
    const loaded = () => root.readyState === 'complete'
    const onOver = (e: Event) => {
        const a = linkOf(e.target)
        if (a === hovered) return
        hovered = a
        clearTimeout(hoverTimer)
        if (a) hoverTimer = setTimeout(() => { if (loaded()) warm(a) }, HOVER_DELAY_MS)
    }
    const onNow = (e: Event) => warm(linkOf(e.target))
    const onFocus = (e: Event) => { if (loaded()) warm(linkOf(e.target)) }
    root.addEventListener('pointerover', onOver, { passive: true })
    root.addEventListener('pointerdown', onNow, { passive: true })
    root.addEventListener('focusin', onFocus)
    const unwarm = installConnectionWarmup(root)
    return () => {
        clearTimeout(hoverTimer)
        root.removeEventListener('pointerover', onOver)
        root.removeEventListener('pointerdown', onNow)
        root.removeEventListener('focusin', onFocus)
        unwarm()
    }
}

/** The tiny file the warm-up asks for: every docs site serves it (App.tsx loads it at boot). */
const WARM_URL = '/ui-config.json'
const ACTIVITY = ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel'] as const

/**
 * A visitor back after IDLE_RISK_MS without input (and nothing fetched in that
 * time) gets one hedged request for WARM_URL, so a connection that died while
 * idle is found and left before the next click (see top). Input that never
 * stops (reading, scrolling) sends nothing. Returns the uninstaller.
 */
export function installConnectionWarmup(root: Document = document, {
    warm = () => fetchWithRetry(WARM_URL, { kind: 'manifest', cache: 'no-store', timeouts: [ATTEMPT_TIMEOUTS_MS[0]] }),
    idleMs = IDLE_RISK_MS,
}: { warm?: () => Promise<unknown>; idleMs?: number } = {}): () => void {
    let lastInput = now()
    let warming = false
    const onInput = () => {
        const t = now()
        const away = t - lastInput > idleMs && t - lastAnswerAt > idleMs
        lastInput = t
        if (!away || warming || root.visibilityState === 'hidden') return
        warming = true
        void warm().catch(() => {}).finally(() => { warming = false })
    }
    const onVisible = () => { if (root.visibilityState === 'visible') onInput() }
    for (const e of ACTIVITY) root.addEventListener(e, onInput, { passive: true, capture: true })
    root.addEventListener('visibilitychange', onVisible)
    return () => {
        for (const e of ACTIVITY) root.removeEventListener(e, onInput, { capture: true })
        root.removeEventListener('visibilitychange', onVisible)
    }
}

/**
 * Run `fn` after the page's `load` event, at idle (afterLoad.ts): a prefetch
 * never makes `load` wait.
 */
export function whenIdle(fn: () => void): () => void {
    return afterLoad(fn)
}
