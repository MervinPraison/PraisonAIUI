// Opt-in load telemetry (fieldTelemetry.ts): what is kept, what is stripped, when it is sent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BATCH, HOLD, fieldRecord, installFieldTelemetry, telemetryTarget, type TelemetryEnv } from './fieldTelemetry'
import { DOCS_LOAD_EVENT, type DocsLoadEvent } from './loadEvents'

const rec = (over: Partial<DocsLoadEvent> = {}): DocsLoadEvent => ({
    v: 1, type: DOCS_LOAD_EVENT, url: '/docs/a.source.md', kind: 'doc', attempt: 1, of: 3, ms: 12.4, outcome: 'ok', at: 5, ...over,
})

test('the target: the own endpoint, else the serving aiui server; off or a static host sends nothing', () => {
    assert.equal(telemetryTarget(undefined, '/api/docs/telemetry'), null) // not opted in: never sent
    assert.equal(telemetryTarget({}, '/api/docs/telemetry'), '/api/docs/telemetry')
    assert.equal(telemetryTarget({ endpoint: 'https://c.example.com/t' }, '/api/docs/telemetry'), 'https://c.example.com/t')
    assert.equal(telemetryTarget({}), null) // telemetry: true on GitHub Pages: no endpoint, no probe
})

test('problems always, ok at the sample rate, inline never; nothing personal', () => {
    const page = '/docs/a?utm_source=x#top'
    const retry = fieldRecord(rec({ outcome: 'retry', reason: 'headers-timeout', url: '/docs/a.source.md?t=1' }), 0, page)
    assert.deepEqual(retry, { url: '/docs/a.source.md', kind: 'doc', attempt: 1, of: 3, ms: 12, outcome: 'retry', reason: 'headers-timeout', page: '/docs/a' })
    assert.equal(fieldRecord(rec(), 0.1, page, () => 0.5), null)
    assert.deepEqual(fieldRecord(rec({ status: 200 }), 0.1, page, () => 0.05)?.sampled, true)
    assert.equal(fieldRecord(rec({ outcome: 'inline' }), 1, page), null)
    const extra = { ...rec({ outcome: 'failed' }), userId: 'u1', ip: '1.2.3.4' } as DocsLoadEvent
    assert.equal('userId' in (fieldRecord(extra, 0, page) ?? {}), false)
})

function fakeEnv(backlog: DocsLoadEvent[] = []) {
    const listeners = new Map<string, Set<(e: Event) => void>>()
    const target = {
        addEventListener: (n: string, f: (e: Event) => void) => { if (!listeners.has(n)) listeners.set(n, new Set()); listeners.get(n)!.add(f) },
        removeEventListener: (n: string, f: (e: Event) => void) => listeners.get(n)?.delete(f),
    }
    const sent: { url: string; body: unknown }[] = []
    const doc = { ...target, visibilityState: 'visible' as DocumentVisibilityState }
    const env: TelemetryEnv = {
        win: { ...target, __aiuiDocsLoad: backlog } as unknown as TelemetryEnv['win'],
        doc: doc as unknown as TelemetryEnv['doc'],
        beacon: (url, body) => { sent.push({ url, body: JSON.parse(body) }); return true },
        page: () => '/docs/a',
        random: () => 0.99,
    }
    const fire = (name: string, detail?: unknown) => {
        for (const f of listeners.get(name) ?? []) f(Object.assign(new Event(name), { detail }))
    }
    return { env, sent, fire, doc, listeners }
}

test('nothing is sent while the page is in use; the batch goes when it is hidden', () => {
    const f = fakeEnv([rec({ outcome: 'retry', reason: 'headers-timeout' }), rec()])
    const stop = installFieldTelemetry('/api/docs/telemetry', {}, f.env)
    f.fire(DOCS_LOAD_EVENT, rec({ outcome: 'failed', reason: 'body-idle' }))
    assert.equal(f.sent.length, 0)
    f.fire('visibilitychange') // still visible
    assert.equal(f.sent.length, 0)
    f.doc.visibilityState = 'hidden'
    f.fire('visibilitychange')
    assert.equal(f.sent.length, 1)
    const body = f.sent[0].body as { v: number; records: { outcome: string }[] }
    assert.deepEqual(body.records.map((r) => r.outcome), ['retry', 'failed']) // the backlog too; ok not sampled
    f.fire('pagehide')
    assert.equal(f.sent.length, 1) // sent once
    stop()
    assert.equal([...f.listeners.values()].reduce((n, s) => n + s.size, 0), 0)
})

test('batches of BATCH, at most HOLD held, a failing beacon never throws', () => {
    const f = fakeEnv()
    installFieldTelemetry('/t', { sampleRate: 1 }, f.env)
    for (let i = 0; i < HOLD + 20; i++) f.fire(DOCS_LOAD_EVENT, rec())
    f.fire('pagehide')
    assert.equal(f.sent.length, HOLD / BATCH)
    assert.ok(f.sent.every((s) => (s.body as { records: unknown[] }).records.length <= BATCH))
    const g = fakeEnv()
    g.env.beacon = () => { throw new Error('boom') }
    installFieldTelemetry('/t', { sampleRate: 1 }, g.env)
    g.fire(DOCS_LOAD_EVENT, rec())
    assert.doesNotThrow(() => g.fire('pagehide'))
})
