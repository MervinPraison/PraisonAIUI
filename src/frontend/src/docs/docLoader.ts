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
 * 10 s so a link that is merely very slow still gets the page. The body has
 * its own, longer limit (it can be large and arrives in pieces).
 */
import { docPathToMarkdown, normalizeDocPath } from '../pathUtils'
import { canonicalDocPath } from './docSource'

export interface DocResult {
    ok: boolean
    status: number
    text: string
}

/** Time to response headers, per attempt (initial request + 2 retries). */
export const ATTEMPT_TIMEOUTS_MS = [5_000, 5_000, 10_000]
/** Time to read the body once the headers are in. */
export const BODY_TIMEOUT_MS = 15_000
const CACHE_LIMIT = 100
const PREFETCH_LIMIT = 4
const HOVER_DELAY_MS = 80

export class DocLoadError extends Error {
    constructor(url: string, cause: unknown) {
        super(`Could not load ${url}`, { cause })
        this.name = 'DocLoadError'
    }
}

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

/** Run `work` with a signal that also aborts after `ms`; a timeout rejects with TimeoutError. */
async function withTimeout<T>(ms: number, parent: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const timer = new AbortController()
    const id = setTimeout(() => timer.abort(new DOMException('Timed out', 'TimeoutError')), ms)
    try {
        return await work(anySignal([parent, timer.signal]))
    } catch (e) {
        if (timer.signal.aborted && !parent.aborted) throw timer.signal.reason
        throw e
    } finally {
        clearTimeout(id)
    }
}

export interface RetryOptions {
    signal?: AbortSignal
    timeouts?: number[]
    bodyTimeoutMs?: number
    fetchImpl?: typeof fetch
    /** Pause before a retry (default 100-400 ms of jitter). */
    backoff?: (attempt: number) => number
}

/**
 * GET `url` with a time limit per attempt and a fresh request after each
 * timeout, network error or 5xx. 2xx and 4xx are answers (no retry). Aborting
 * `signal` stops at once with an AbortError. All attempts failed: DocLoadError.
 */
export async function fetchWithRetry(url: string, opts: RetryOptions = {}): Promise<DocResult> {
    const {
        signal = new AbortController().signal,
        timeouts = ATTEMPT_TIMEOUTS_MS,
        bodyTimeoutMs = BODY_TIMEOUT_MS,
        fetchImpl = (...args) => fetch(...args),
        backoff = () => 100 + Math.random() * 300,
    } = opts
    let lastError: unknown = null
    for (let attempt = 0; attempt < timeouts.length; attempt++) {
        if (signal.aborted) throw abortError()
        try {
            const response = await withTimeout(timeouts[attempt], signal, (s) => fetchImpl(url, { signal: s }))
            if (response.status < 500) {
                const text = response.ok ? await withTimeout(bodyTimeoutMs, signal, () => response.text()) : ''
                return { ok: response.ok, status: response.status, text }
            }
            lastError = new Error(`HTTP ${response.status}`)
        } catch (e) {
            if (signal.aborted) throw abortError()
            lastError = e
        }
        if (attempt < timeouts.length - 1) await sleep(backoff(attempt), signal)
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
}

const cache = new Map<string, DocResult>()
const flights = new Map<string, Flight>()

function remember(url: string, result: DocResult) {
    cache.delete(url)
    cache.set(url, result)
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
}

function startFlight(url: string, prefetch: boolean): Flight {
    const controller = new AbortController()
    const flight: Flight = { controller, waiters: 0, prefetch, promise: Promise.resolve(null as unknown as DocResult) }
    flight.promise = fetchWithRetry(url, { signal: controller.signal }).then(
        (result) => {
            // 2xx and 404 are stable answers; other 4xx may be transient (auth, rate limit).
            if (result.ok || result.status === 404) remember(url, result)
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
 * never queue requests: the last click wins.
 */
export function loadDoc(url: string, signal: AbortSignal): Promise<DocResult> {
    const hit = cache.get(url)
    if (hit) return Promise.resolve(hit)
    if (signal.aborted) return Promise.reject(abortError())
    const flight = flights.get(url) ?? startFlight(url, false)
    flight.waiters += 1
    flight.prefetch = false
    return new Promise<DocResult>((resolve, reject) => {
        const onAbort = () => {
            flight.waiters -= 1
            if (flight.waiters === 0 && !flight.prefetch) {
                flight.controller.abort()
                if (flights.get(url) === flight) flights.delete(url)
            }
            reject(abortError())
        }
        signal.addEventListener('abort', onAbort, { once: true })
        flight.promise.then(
            (r) => {
                signal.removeEventListener('abort', onAbort)
                resolve(r)
            },
            (e) => {
                signal.removeEventListener('abort', onAbort)
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

/**
 * On a deep link under the docs base, start loading that page's markdown
 * while the app is still fetching its manifests, instead of one round trip
 * after them. Content.tsx then joins this request (or finds it cached). The
 * site root is skipped: in the chat and agents styles `/` is not a docs page.
 */
export function prefetchInitialDoc(pathname = window.location.pathname, base = '/docs'): string | null {
    const path = normalizeDocPath(pathname)
    if (path !== base && !path.startsWith(`${base}/`)) return null
    const url = docPathToMarkdown(canonicalDocPath(path, base))
    prefetchDoc(url)
    return url
}

/** Test hook: forget every cached answer and cancel every request. */
export function resetDocCache(): void {
    for (const f of flights.values()) f.controller.abort()
    flights.clear()
    cache.clear()
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
    const path = normalizeDocPath(url.pathname)
    if (path !== '/' && !path.startsWith(`${base}/`)) return null
    const last = path.split('/').pop() || ''
    if (last.includes('.') && !last.endsWith('.md')) return null // assets, images
    return docPathToMarkdown(path.replace(/\.md$/, ''))
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
    const onOver = (e: Event) => {
        const a = linkOf(e.target)
        if (a === hovered) return
        hovered = a
        clearTimeout(hoverTimer)
        if (a) hoverTimer = setTimeout(() => warm(a), HOVER_DELAY_MS)
    }
    const onNow = (e: Event) => warm(linkOf(e.target))
    root.addEventListener('pointerover', onOver, { passive: true })
    root.addEventListener('pointerdown', onNow, { passive: true })
    root.addEventListener('focusin', onNow)
    return () => {
        clearTimeout(hoverTimer)
        root.removeEventListener('pointerover', onOver)
        root.removeEventListener('pointerdown', onNow)
        root.removeEventListener('focusin', onNow)
    }
}

/** Run `fn` when the browser is idle (or after a short delay without requestIdleCallback). */
export function whenIdle(fn: () => void): () => void {
    if (typeof window.requestIdleCallback === 'function') {
        const id = window.requestIdleCallback(fn, { timeout: 3_000 })
        return () => window.cancelIdleCallback(id)
    }
    const id = setTimeout(fn, 300)
    return () => clearTimeout(id)
}
