// Where "Was this page helpful?" votes go (feedback.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newVoteId, sendVote, voteTarget } from './feedback'

/** A fetch that answers `reply` and records each call. */
function fakeFetch(reply: () => Response | Error) {
    const calls: RequestInit[] = []
    const impl = (async (_url: string, init?: RequestInit) => {
        calls.push(init ?? {})
        const r = reply()
        if (r instanceof Error) throw r
        return r
    }) as unknown as typeof fetch
    return { calls, impl }
}
const json = (body: unknown) => () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

test('the target: the aiui server (asked once per page load), a configured endpoint, or none', async () => {
    const f = fakeFetch(json({ enabled: true }))
    assert.equal(await voteTarget({}, '/api/docs/feedback', f.impl), '/api/docs/feedback')
    assert.equal(await voteTarget({}, '/api/docs/feedback', f.impl), '/api/docs/feedback')
    assert.equal(await voteTarget({ endpoint: 'https://hooks.example.com/v' }, '/x', f.impl), 'https://hooks.example.com/v')
    assert.equal(await voteTarget({ endpoint: false }, '/x', f.impl), null)
    assert.equal(f.calls.length, 1)
    // A static host answers 404, or its HTML page for any path; offline is no server either.
    assert.equal(await voteTarget({}, '/a', fakeFetch(() => new Response('nope', { status: 404 })).impl), null)
    assert.equal(await voteTarget({}, '/b', fakeFetch(() => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })).impl), null)
    assert.equal(await voteTarget({}, '/c', fakeFetch(() => new Error('offline')).impl), null)
})

test('a vote is POSTed as JSON with keepalive; no target posts nothing', async () => {
    const f = fakeFetch(json({ ok: true }))
    const vote = { id: newVoteId(), path: '/docs/a', value: -1 as const, comment: 'missing step' }
    assert.equal(await sendVote('/api/docs/feedback', vote, f.impl), true)
    assert.equal(f.calls[0].method, 'POST')
    assert.equal(f.calls[0].keepalive, true)
    assert.deepEqual(JSON.parse(String(f.calls[0].body)), vote)
    assert.equal(await sendVote(null, vote, f.impl), false)
    assert.equal(f.calls.length, 1)
    assert.equal(await sendVote('/x', vote, fakeFetch(() => new Response('', { status: 429 })).impl), false)
    assert.match(vote.id, /^[A-Za-z0-9-]{8,64}$/)
})
