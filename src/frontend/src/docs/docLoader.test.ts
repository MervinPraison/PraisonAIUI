// Docs markdown loader: per-attempt time limit, retry, cache, shared prefetches.
import { afterEach, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
    DocLoadError,
    INITIAL_DOC_ID,
    adoptInlinedDoc,
    docHrefMarkdownUrl,
    fetchWithRetry,
    loadDoc,
    peekDoc,
    prefetchDoc,
    prefetchInitialDoc,
    resetDocCache,
} from './docLoader'

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
