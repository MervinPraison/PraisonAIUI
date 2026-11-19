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

test('the target: a configured endpoint, the serving aiui server, or none, with no request', () => {
    // `server`: ui-config.json `docsFeedback.url`, sent only by aiui serve / aiui dev (docs_feedback.py).
    assert.equal(voteTarget({}, '/api/docs/feedback'), '/api/docs/feedback')
    assert.equal(voteTarget({ endpoint: 'https://hooks.example.com/v' }, '/api/docs/feedback'), 'https://hooks.example.com/v')
    assert.equal(voteTarget({ endpoint: 'https://hooks.example.com/v' }), 'https://hooks.example.com/v')
    assert.equal(voteTarget({ endpoint: false }, '/api/docs/feedback'), null)
    // A static host (GitHub Pages): no endpoint named, so nothing is asked and nothing 404s.
    assert.equal(voteTarget({}), null)
    assert.equal(voteTarget({}, null), null)
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
