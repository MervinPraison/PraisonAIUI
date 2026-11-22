// Docs markdown loader: per-attempt time limit, retry, cache, shared prefetches.
import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
    DocLoadError,
    NETWORK_CHANGE_MIN_MS,
    BOOT_DATA_ID,
    INITIAL_DOC_ID,
    adoptInlinedDoc,
    inlinedManifest,
    docHrefMarkdownUrl,
    fetchWithRetry,
    loadDoc,
    peekDoc,
    prefetchDoc,
    prefetchInitialDoc,
    resetDocCache,
} from './docLoader'
import { recordDocsLoad, type DocsLoadEvent } from './loadEvents'

type Answer = Response | Error | 'hang'

/** A fetch that answers call i with answers[i]; 'hang' (and anything past the list) waits until aborted. */
function scriptedFetch(answers: Answer[]) {
    const calls: AbortSignal[] = []
    const impl = ((_url: RequestInfo | URL, init?: RequestInit) => {
        const signal = init!.signal!
        calls.push(signal)
        const answer = answers[calls.length - 1] ?? 'hang'
        if (answer instanceof Response) return Promise.resolve(answer)
        if (answer instanceof Error) return Promise.reject(answer)
        return new Promise<Response>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')))
        })
    }) as typeof fetch
    return { impl, calls }
}

const realFetch = globalThis.fetch
function stubFetch(answers: Answer[]) {
    const scripted = scriptedFetch(answers)
    globalThis.fetch = scripted.impl
    return scripted
}

const fast = { timeouts: [20, 20, 40], bodyTimeoutMs: 50, backoff: () => 0 }
const isAbort = (e: unknown) => (e as Error).name === 'AbortError'
const tick = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
    resetDocCache()
    globalThis.fetch = realFetch
})

describe('fetchWithRetry', () => {
    test('aborts an attempt past its time limit and retries with a fresh request', async () => {
        const { impl, calls } = scriptedFetch(['hang', new Response('# Page')])
        const result = await fetchWithRetry('/docs/a.md', { ...fast, fetchImpl: impl })
        assert.deepEqual(result, { ok: true, status: 200, text: '# Page' })
        assert.equal(calls.length, 2)
        assert.equal(calls[0].aborted, true) // the stalled request was cancelled, not left running
    })

    test('retries network errors and 5xx, then gives up with DocLoadError', async () => {
        const { impl, calls } = scriptedFetch([new TypeError('Failed to fetch'), new Response('', { status: 503 }), 'hang'])
        await assert.rejects(fetchWithRetry('/docs/a.md', { ...fast, fetchImpl: impl }), DocLoadError)
        assert.equal(calls.length, 3)
    })

    test('treats 404 as an answer: no retry', async () => {
        const { impl, calls } = scriptedFetch([new Response('nope', { status: 404 })])
        assert.deepEqual(await fetchWithRetry('/docs/a.md', { ...fast, fetchImpl: impl }), { ok: false, status: 404, text: '' })
        assert.equal(calls.length, 1)
    })

    test('a body that stalls after the headers is cut off past its time limit and retried', async () => {
        // Headers arrive, one chunk of the body, then nothing: the reader sat on the skeleton for ever.
        const stalled = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('# part')) } }))
        const { impl, calls } = scriptedFetch([stalled, new Response('# Page')])
        const started = Date.now()
        const result = await fetchWithRetry('/docs/a.md', { ...fast, fetchImpl: impl })
        assert.deepEqual(result, { ok: true, status: 200, text: '# Page' })
        assert.equal(calls.length, 2)
        assert.equal(calls[0].aborted, true) // its signal aborted: a real fetch cancels the body
        assert.ok(Date.now() - started < 1_000)
    })

    test('a body that keeps stalling ends in DocLoadError, never a pending promise', async () => {
        const stalled = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('#')) } }))
        const { impl } = scriptedFetch([stalled(), stalled(), stalled()])
        await assert.rejects(fetchWithRetry('/docs/a.md', { ...fast, fetchImpl: impl }), DocLoadError)
    })

    /** A body that sends `chunks` pieces `everyMs` apart (Infinity: for ever), then ends. */
    const trickle = (everyMs: number, chunks: number) => {
        let timer: ReturnType<typeof setInterval>
        let sent = 0
        return new Response(new ReadableStream({
            start(c) {
                timer = setInterval(() => {
                    if (sent++ < chunks) c.enqueue(new TextEncoder().encode('x'))
                    else {
                        clearInterval(timer)
                        c.close()
                    }
                }, everyMs)
            },
            cancel() {
                clearInterval(timer)
            },
        }))
    }

    test('a body that sends nothing for the idle limit is retried long before the total limit', async () => {
        const stalled = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('# part')) } }))
        const { impl, calls } = scriptedFetch([stalled, new Response('# Page')])
        const started = Date.now()
        const result = await fetchWithRetry('/docs/a.md', { ...fast, bodyTimeoutMs: 5_000, bodyIdleTimeoutMs: 40, fetchImpl: impl })
        assert.deepEqual(result, { ok: true, status: 200, text: '# Page' })
        assert.equal(calls[0].aborted, true)
        assert.ok(Date.now() - started < 1_000, 'cut off by the idle limit, not the 5 s total')
    })

    test('a slow body that keeps sending bytes is not cut off by the idle limit', async () => {
        // 8 chunks 15 ms apart: 120 ms in all, past the 40 ms idle limit but never 40 ms without a byte.
        const { impl, calls } = scriptedFetch([trickle(15, 8)])
        const result = await fetchWithRetry('/docs/a.md', { ...fast, bodyTimeoutMs: 2_000, bodyIdleTimeoutMs: 40, fetchImpl: impl })
        assert.deepEqual(result, { ok: true, status: 200, text: 'xxxxxxxx' })
        assert.equal(calls.length, 1)
    })

    test('a body that trickles past the total limit is still cut off, then DocLoadError', async () => {
        const { impl, calls } = scriptedFetch([trickle(5, Infinity), trickle(5, Infinity), trickle(5, Infinity)])
        await assert.rejects(fetchWithRetry('/docs/a.md', { ...fast, bodyTimeoutMs: 60, bodyIdleTimeoutMs: 40, fetchImpl: impl }), DocLoadError)
        assert.equal(calls.length, 3)
        assert.ok(calls.every((c) => c.aborted))
    })

    test('decodes a multi-byte character split across chunks', async () => {
        const bytes = new TextEncoder().encode('é ü')
        const split = new Response(new ReadableStream({
            start(c) {
                c.enqueue(bytes.slice(0, 1))
                c.enqueue(bytes.slice(1))
                c.close()
            },
        }))
        const { impl } = scriptedFetch([split])
        assert.equal((await fetchWithRetry('/docs/a.md', { ...fast, fetchImpl: impl })).text, 'é ü')
    })

    test('stops at once, without retrying, when the caller aborts', async () => {
        const { impl, calls } = scriptedFetch(['hang'])
        const nav = new AbortController()
        const pending = fetchWithRetry('/docs/a.md', { ...fast, timeouts: [5_000, 5_000], fetchImpl: impl, signal: nav.signal })
        await tick()
        nav.abort()
        await assert.rejects(pending, isAbort)
        assert.equal(calls.length, 1)
        assert.equal(calls[0].aborted, true)
    })
})

describe('loadDoc / prefetchDoc', () => {
    test('caches answers: a second load makes no request', async () => {
        const { calls } = stubFetch([new Response('# A')])
        await loadDoc('/docs/a.md', new AbortController().signal)
        assert.equal(peekDoc('/docs/a.md')?.text, '# A')
        await loadDoc('/docs/a.md', new AbortController().signal)
        assert.equal(calls.length, 1)
    })

    test('caches a 404 too', async () => {
        const { calls } = stubFetch([new Response('', { status: 404 })])
        assert.equal((await loadDoc('/docs/x.md', new AbortController().signal)).status, 404)
        await loadDoc('/docs/x.md', new AbortController().signal)
        assert.equal(calls.length, 1)
    })

    test('a navigation joins a prefetch in flight instead of fetching again', async () => {
        let release!: (r: Response) => void
        let count = 0
        globalThis.fetch = (() => {
            count += 1
            return new Promise<Response>((resolve) => { release = resolve })
        }) as typeof fetch
        prefetchDoc('/docs/a.md')
        const loading = loadDoc('/docs/a.md', new AbortController().signal)
        await tick()
        release(new Response('# A'))
        assert.equal((await loading).text, '# A')
        assert.equal(count, 1)
    })

    test('the next click cancels the previous request (the last click wins)', async () => {
        const { calls } = stubFetch(['hang'])
        const first = new AbortController()
        const a = loadDoc('/docs/a.md', first.signal)
        await tick()
        first.abort()
        await assert.rejects(a, isAbort)
        assert.equal(calls[0].aborted, true)
    })

    test('a prefetch the click joined is cancelled by the next click', async () => {
        const { calls } = stubFetch(['hang'])
        prefetchDoc('/docs/a.md') // pointerdown
        const nav = new AbortController()
        const a = loadDoc('/docs/a.md', nav.signal) // the click joins it
        await tick()
        nav.abort() // the next click
        await assert.rejects(a, isAbort)
        assert.equal(calls.length, 1)
        assert.equal(calls[0].aborted, true)
    })

    test('a prefetch nobody navigated to keeps running and fills the cache', async () => {
        stubFetch([new Response('# B')])
        prefetchDoc('/docs/b.md')
        for (let i = 0; i < 20 && !peekDoc('/docs/b.md'); i++) await tick()
        assert.equal(peekDoc('/docs/b.md')?.text, '# B')
    })
})

describe('docHrefMarkdownUrl', () => {
    const page = 'https://site.test/docs/guide/first'

    test('maps docs links to their markdown file', () => {
        assert.equal(docHrefMarkdownUrl('/docs/guide/second', page), '/docs/guide/second.source.md')
        assert.equal(docHrefMarkdownUrl('/docs/guide/second/#install', page), '/docs/guide/second.source.md')
        assert.equal(docHrefMarkdownUrl('/docs/guide/second.md', page), '/docs/guide/second.source.md')
        assert.equal(docHrefMarkdownUrl('second', page), '/docs/guide/second.source.md')
        assert.equal(docHrefMarkdownUrl('/', page), '/docs/index.source.md')
        assert.equal(docHrefMarkdownUrl('/docs/guide/second.html', page), '/docs/guide/second.source.md')
        assert.equal(docHrefMarkdownUrl('/docs/guide/index.html', page), '/docs/guide.source.md')
    })

    test('ignores other origins, other sections and files', () => {
        assert.equal(docHrefMarkdownUrl('https://example.com/docs/a', page), null)
        assert.equal(docHrefMarkdownUrl('/chat', page), null)
        assert.equal(docHrefMarkdownUrl('/docs/images/x.png', page), null)
    })
})

describe('prefetchInitialDoc', () => {
    test('a deep link under /docs starts its markdown at boot', () => {
        const { calls } = stubFetch(['hang'])
        assert.equal(prefetchInitialDoc('/docs/guide/first'), '/docs/guide/first.source.md')
        assert.equal(prefetchInitialDoc('/docs'), '/docs/index.source.md')
        assert.equal(calls.length, 2)
    })

    test('a page\'s .html file URL loads the page\'s markdown, not x.html.source.md', () => {
        const { calls } = stubFetch(['hang'])
        assert.equal(prefetchInitialDoc('/docs/api/sessions.html'), '/docs/api/sessions.source.md')
        assert.equal(prefetchInitialDoc('/docs/api/health/index.html'), '/docs/api/health.source.md')
        assert.equal(prefetchInitialDoc('/docs/index.html'), '/docs/index.source.md')
        assert.equal(calls.length, 3)
    })

    test('the site root and other sections fetch nothing (chat and agents live there)', () => {
        const { calls } = stubFetch(['hang'])
        assert.equal(prefetchInitialDoc('/'), null)
        assert.equal(prefetchInitialDoc('/chat'), null)
        assert.equal(prefetchInitialDoc('/documents/x'), null)
        assert.equal(calls.length, 0)
    })
})


describe('markdown inlined by aiui build', () => {
    afterEach(() => resetDocCache())
    function page(json: string | null) {
        let removed = false
        const el = json === null ? null : { textContent: json, remove: () => { removed = true } }
        return { root: { getElementById: (id: string) => (id === INITIAL_DOC_ID ? el : null) }, removed: () => removed }
    }

    test('seeds the cache, so the page renders without a request', () => {
        const p = page(JSON.stringify({ url: '/docs/guide/first.md', text: '# First\n' }))
        assert.equal(adoptInlinedDoc(p.root), '/docs/guide/first.md')
        assert.deepEqual(peekDoc('/docs/guide/first.md'), { ok: true, status: 200, text: '# First\n' })
        assert.equal(p.removed(), true)
    })

    test('a missing or malformed block changes nothing', () => {
        assert.equal(adoptInlinedDoc(page(null).root), null)
        assert.equal(adoptInlinedDoc(page('{not json').root), null)
        assert.equal(adoptInlinedDoc(page(JSON.stringify({ url: '/docs/x.md' })).root), null)
        assert.equal(adoptInlinedDoc(page(JSON.stringify({ url: '/ui-config.json', text: '{}' })).root), null)
        assert.equal(adoptInlinedDoc(undefined), null)
        assert.equal(peekDoc('/docs/x.md'), undefined)
    })
})

describe('site manifests inlined by aiui build', () => {
    function page(json: string | null) {
        let removed = false
        const el = json === null ? null : { textContent: json, remove: () => { removed = true } }
        return { root: { getElementById: (id: string) => (id === BOOT_DATA_ID ? el : null) }, removed: () => removed }
    }

    test('hands back each inlined file by URL and leaves the block for the legacy nav plugin', () => {
        const nav = { items: [{ title: 'Guide', path: '/docs/guide' }] }
        const p = page(JSON.stringify({ '/docs-nav.json': nav, '/route-manifest.json': {} }))
        assert.deepEqual(inlinedManifest('/docs-nav.json', p.root), nav)
        assert.deepEqual(inlinedManifest('/route-manifest.json', p.root), {})
        assert.equal(p.removed(), false)
    })

    test('a file not inlined, a missing or malformed block: undefined (the app fetches it)', () => {
        const p = page(JSON.stringify({ '/docs-nav.json': { items: [] } }))
        assert.equal(inlinedManifest('/ui-config.json', p.root), undefined)
        assert.equal(inlinedManifest('/toString', p.root), undefined)
        assert.equal(inlinedManifest('/docs-nav.json', page(null).root), undefined)
        assert.equal(inlinedManifest('/docs-nav.json', page('{not json').root), undefined)
        assert.equal(inlinedManifest('/docs-nav.json', page('[1]').root), undefined)
        assert.equal(inlinedManifest('/docs-nav.json', undefined), undefined)
    })
})

// ── Requests that cannot queue behind a peer, and the aiui:docs-load record ──

type Logged = { __aiuiDocsLoad?: DocsLoadEvent[] }
const logged = () => ((globalThis as Logged).__aiuiDocsLoad ??= [])

/** A fetch recording each call's cache mode; 'hang' waits until aborted. */
function modeFetch(answers: Answer[]) {
    const modes: (RequestCache | undefined)[] = []
    const impl = ((_url: RequestInfo | URL, init?: RequestInit) => {
        modes.push(init?.cache)
        const answer = answers[modes.length - 1] ?? 'hang'
        if (answer instanceof Response) return Promise.resolve(answer)
        if (answer instanceof Error) return Promise.reject(answer)
        const signal = init!.signal!
        return new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
    }) as typeof fetch
    return { impl, modes }
}

describe('HTTP cache lock (a peer request for the same URL)', () => {
    afterEach(() => { logged().length = 0 })

    test('a retry never goes through the HTTP cache, so it cannot wait on a peer', async () => {
        const { impl, modes } = modeFetch(['hang', 'hang', new Response('# Page')])
        await fetchWithRetry('/docs/a.source.md', { ...fast, fetchImpl: impl })
        assert.deepEqual(modes, ['default', 'no-store', 'no-store'])
    })

    test("a page's markdown is requested no-store from the first attempt", async () => {
        const { impl, modes } = modeFetch([new Response('# A')])
        globalThis.fetch = impl
        await loadDoc('/docs/a.source.md', new AbortController().signal)
        prefetchDoc('/docs/b.source.md')
        assert.deepEqual(modes, ['no-store', 'no-store'])
    })
})

describe('a network change during an attempt (a dead shared connection)', () => {
    /** A watchNetwork stub: `change()` plays a network change to whoever listens now. */
    const network = () => {
        const listeners = new Set<() => void>()
        return {
            watch: (fn: () => void) => { listeners.add(fn); return () => void listeners.delete(fn) },
            change: () => [...listeners].forEach((fn) => fn()),
            listening: () => listeners.size,
        }
    }
    const slow = { timeouts: [10_000, 10_000, 10_000], bodyTimeoutMs: 50, backoff: () => 0 }

    test('ends the waiting attempt at once and sends a fresh request, recorded as network-change', async () => {
        logged().length = 0
        const net = network()
        const { impl, calls } = scriptedFetch(['hang', new Response('# Page')])
        const started = Date.now()
        const result = fetchWithRetry('/docs/a.source.md', { ...slow, fetchImpl: impl, watchNetwork: net.watch })
        await new Promise((r) => setTimeout(r, NETWORK_CHANGE_MIN_MS + 50))
        net.change()
        assert.equal((await result).text, '# Page')
        assert.ok(Date.now() - started < 2_000) // not the 10 s limit
        assert.equal(calls[0].aborted, true)
        assert.deepEqual(logged().map((e) => [e.attempt, e.outcome, e.reason ?? null]), [[1, 'retry', 'network-change'], [2, 'ok', null]])
        assert.equal(net.listening(), 0)
        logged().length = 0
    })

    test('a body still arriving is left alone (the connection is alive)', async () => {
        logged().length = 0
        const net = network()
        let sent = 0
        let timer: ReturnType<typeof setInterval>
        const body = new Response(new ReadableStream({
            start(c) {
                timer = setInterval(() => {
                    if (sent++ < 8) c.enqueue(new TextEncoder().encode('x'))
                    else { clearInterval(timer); c.close() }
                }, 100)
            },
            cancel() { clearInterval(timer) },
        }))
        const { impl, calls } = scriptedFetch([body])
        const opts = { timeouts: [10_000, 10_000], bodyTimeoutMs: 5_000, bodyIdleTimeoutMs: 1_000, backoff: () => 0, fetchImpl: impl, watchNetwork: net.watch }
        const result = fetchWithRetry('/docs/a.source.md', opts)
        await new Promise((r) => setTimeout(r, NETWORK_CHANGE_MIN_MS + 150))
        net.change()
        assert.equal((await result).text, 'xxxxxxxx')
        assert.equal(calls.length, 1)
        assert.equal(calls[0].aborted, false)
        logged().length = 0
    })

    test('an attempt that just started, or the last one, is left alone', async () => {
        const net = network()
        const { impl, calls } = scriptedFetch([new Error('reset'), new Error('reset'), 'hang'])
        const opts = { timeouts: [20, 20, 800], bodyTimeoutMs: 50, backoff: () => 0, fetchImpl: impl, watchNetwork: net.watch }
        const result = assert.rejects(fetchWithRetry('/docs/a.source.md', opts), DocLoadError)
        await new Promise((r) => setTimeout(r, 100))
        assert.equal(calls.length, 3)
        assert.equal(net.listening(), 0) // the last attempt does not listen
        net.change()
        await new Promise((r) => setTimeout(r, 0))
        assert.equal(calls[2].aborted, false)
        await result
        logged().length = 0
    })
})

describe('aiui:docs-load records', () => {
    afterEach(() => { logged().length = 0 })

    test('each attempt is recorded with its outcome and reason', async () => {
        const { impl } = modeFetch(['hang', new Error('reset'), new Response('# Page')])
        await fetchWithRetry('/docs/a.source.md', { ...fast, fetchImpl: impl })
        const rows = logged().map((e) => [e.v, e.type, e.url, e.kind, e.attempt, e.of, e.outcome, e.reason ?? null, e.status ?? null])
        assert.deepEqual(rows, [
            [1, 'aiui:docs-load', '/docs/a.source.md', 'doc', 1, 3, 'retry', 'headers-timeout', null],
            [1, 'aiui:docs-load', '/docs/a.source.md', 'doc', 2, 3, 'retry', 'network-error', null],
            [1, 'aiui:docs-load', '/docs/a.source.md', 'doc', 3, 3, 'ok', null, 200],
        ])
        assert.ok(logged().every((e) => typeof e.ms === 'number' && typeof e.at === 'number'))
    })

    test('a stalled body and a 5xx are told apart; the last failure says failed', async () => {
        const stalled = new Response(new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode('# Pa')) }))
        const { impl } = modeFetch([stalled, new Response('', { status: 503 }), 'hang'])
        await assert.rejects(fetchWithRetry('/m.json', { ...fast, bodyIdleTimeoutMs: 20, kind: 'manifest', fetchImpl: impl }), DocLoadError)
        assert.deepEqual(logged().map((e) => [e.kind, e.outcome, e.reason, e.status ?? null]), [
            ['manifest', 'retry', 'body-idle', 200],
            ['manifest', 'retry', 'http-5xx', 503],
            ['manifest', 'failed', 'headers-timeout', null],
        ])
    })

    test('a navigation hears about retries (to say so instead of a silent skeleton)', async () => {
        globalThis.fetch = modeFetch([new Error('reset'), new Response('# A')]).impl
        const heard: number[][] = []
        const result = await loadDoc('/docs/a.source.md', new AbortController().signal, (attempt, of) => heard.push([attempt, of]))
        assert.equal(result.text, '# A')
        assert.deepEqual(heard, [[2, 3]])
    })

    test('inlined markdown keyed by another URL than the page loads is reported', () => {
        globalThis.fetch = modeFetch(['hang']).impl
        const el = { textContent: JSON.stringify({ url: '/docs/guide/index.source.md', text: '# G' }), remove() {} }
        const root = { getElementById: (id: string) => (id === INITIAL_DOC_ID ? el : null) }
        prefetchInitialDoc('/docs/guide', '/docs', root)
        const outcomes = logged().map((e) => [e.outcome, e.url, e.detail ?? null])
        assert.deepEqual(outcomes, [
            ['inline', '/docs/guide/index.source.md', null],
            ['inline-mismatch', '/docs/guide.source.md', 'inlined as /docs/guide/index.source.md'],
        ])
    })

    test('inlined markdown under the right URL: recorded, and no request', () => {
        const { impl, modes } = modeFetch(['hang'])
        globalThis.fetch = impl
        const el = { textContent: JSON.stringify({ url: '/docs/guide.source.md', text: '# G' }), remove() {} }
        prefetchInitialDoc('/docs/guide', '/docs', { getElementById: (id: string) => (id === INITIAL_DOC_ID ? el : null) })
        assert.deepEqual(logged().map((e) => e.outcome), ['inline'])
        assert.equal(modes.length, 0)
    })

    test('the record keeps the newest 200', () => {
        for (let i = 0; i < 205; i++) recordDocsLoad({ url: `/docs/${i}.md`, kind: 'doc', attempt: 1, of: 3, ms: 1, outcome: 'ok' })
        assert.equal(logged().length, 200)
        assert.equal(logged()[0].url, '/docs/5.md')
    })
})
