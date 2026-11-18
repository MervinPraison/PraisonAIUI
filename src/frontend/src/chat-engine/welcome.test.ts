// npm test -- chat-engine/welcome
// @aiui.welcome: the greeting POST /welcome streams is read into plain text.
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchWelcome, parseWelcomeStream, resetWelcomeForTests } from './welcome'

const sse = (...events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')

afterEach(() => resetWelcomeForTests())

test('aiui.say messages become the greeting, one paragraph each', () => {
  const body = sse({ type: 'message', content: 'Welcome!' }, { type: 'message', content: 'Ask me anything.' }, { type: 'end' })
  assert.equal(parseWelcomeStream(body), 'Welcome!\n\nAsk me anything.')
})

test('streamed tokens join into one paragraph', () => {
  assert.equal(parseWelcomeStream(sse({ type: 'token', token: 'Hel' }, { type: 'token', token: 'lo' }, { type: 'end' })), 'Hello')
})

test('a streamed Message shows once: its final message replaces the tokens', () => {
  const body = sse(
    { type: 'run_started', message_id: 'm1' },
    { type: 'token', message_id: 'm1', token: 'Hel' },
    { type: 'token', message_id: 'm1', token: 'lo' },
    { type: 'message', message_id: 'm1', content: 'Hello' },
    { type: 'message', message_id: 'm2', content: 'Ask away.' },
    { type: 'end' },
  )
  assert.equal(parseWelcomeStream(body), 'Hello\n\nAsk away.')
})

test('an app without a welcome callback, an error or junk gives no greeting', () => {
  assert.equal(parseWelcomeStream(sse({ type: 'end' })), '')
  assert.equal(parseWelcomeStream(sse({ type: 'error', error: 'boom' }, { type: 'end' })), '')
  assert.equal(parseWelcomeStream('data: {not json\n\n: comment\n'), '')
})

test('fetchWelcome posts to /welcome once per page load', async () => {
  const calls: { url: string; method?: string }[] = []
  const prev = globalThis.fetch
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method })
    return new Response(sse({ type: 'message', content: 'Hi there' }, { type: 'end' }), { status: 200 })
  }) as typeof fetch
  try {
    assert.equal(await fetchWelcome(), 'Hi there')
    assert.equal(await fetchWelcome(), 'Hi there')
    assert.deepEqual(calls, [{ url: '/welcome', method: 'POST' }])
  } finally {
    globalThis.fetch = prev
  }
})

test('fetchWelcome gives no greeting when the request fails', async () => {
  const prev = globalThis.fetch
  globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch
  try {
    assert.equal(await fetchWelcome(), '')
  } finally {
    globalThis.fetch = prev
  }
})
