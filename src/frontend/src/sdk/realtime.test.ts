import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { getWsTicket, openWebSocket, TOKEN_STORAGE_KEY, WS_TICKET_URL, wsAuthQuery } from '@/sdk/realtime'

const g = globalThis as unknown as Record<string, unknown>

const savedLocation = g.location
const savedStorage = g.sessionStorage
const savedFetch = g.fetch
const savedWebSocket = g.WebSocket

function setToken(token: string | null) {
  const store = new Map<string, string>()
  if (token !== null) store.set(TOKEN_STORAGE_KEY, token)
  g.sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
}

beforeEach(() => {
  g.location = { protocol: 'http:', host: 'app.test:8080', href: 'http://app.test:8080/' }
  setToken(null)
})

afterEach(() => {
  g.location = savedLocation
  g.sessionStorage = savedStorage
  g.fetch = savedFetch
  g.WebSocket = savedWebSocket
})

test('getWsTicket exchanges credentials for a single-use ticket and sends Bearer when stored', async () => {
  setToken('tok-secret')
  const calls: { url: string; method?: string; auth: string | null; creds?: RequestCredentials }[] = []
  g.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const h = new Headers(init.headers)
    calls.push({ url: String(input), method: init.method, auth: h.get('Authorization'), creds: init.credentials })
    return new Response(JSON.stringify({ ticket: 'tkt-123', expires_in: 60 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const ticket = await getWsTicket()
  assert.equal(ticket, 'tkt-123')
  assert.deepEqual(calls, [{ url: WS_TICKET_URL, method: 'POST', auth: 'Bearer tok-secret', creds: 'same-origin' }])
})

test('getWsTicket works with cookie credentials when no bearer token is stored and returns null on failure', async () => {
  g.fetch = async (_input: RequestInfo | URL, init: RequestInit = {}) => {
    const h = new Headers(init.headers)
    assert.equal(h.get('Authorization'), null)
    assert.equal(init.credentials, 'same-origin')
    return new Response(JSON.stringify({ ticket: 'cookie-tkt' }), { status: 200 })
  }
  assert.equal(await getWsTicket(), 'cookie-tkt')

  g.fetch = async () => new Response('unauthorized', { status: 401 })
  assert.equal(await getWsTicket(), null)
})

test('wsAuthQuery keeps chat transport fallback on 404 while respecting 403 refusal', async () => {
  assert.equal(await wsAuthQuery(), '')

  setToken('my tok')
  const okFetch: typeof fetch = async () => new Response(JSON.stringify({ ticket: 'one-time' }), { status: 200 })
  assert.equal(await wsAuthQuery(okFetch), '?ticket=one-time')

  const refusedFetch: typeof fetch = async () => new Response('forbidden', { status: 403 })
  assert.equal(await wsAuthQuery(refusedFetch), '')

  const oldServerFetch: typeof fetch = async () => new Response('not found', { status: 404 })
  assert.equal(await wsAuthQuery(oldServerFetch), '?token=my%20tok')
})

test('openWebSocket resolves relative paths, preserves query params, forwards protocols, and attaches single-use ticket', async () => {
  g.location = { protocol: 'https:', host: 'studio.example', href: 'https://studio.example/code' }
  setToken('tok-abc')
  const opened: { url: string; protocols?: string | string[] }[] = []

  g.WebSocket = class FakeWebSocket {
    url: string
    constructor(url: string, protocols?: string | string[]) {
      this.url = url
      opened.push({ url, protocols })
    }
  }
  g.fetch = async () => new Response(JSON.stringify({ ticket: 'ws-tkt-1' }), { status: 200 })

  await openWebSocket('/api/plugins/code/ws/events?run=42', ['v1'])

  assert.deepEqual(opened, [
    { url: 'wss://studio.example/api/plugins/code/ws/events?run=42&ticket=ws-tkt-1', protocols: ['v1'] },
  ])
})

test('openWebSocket never places a long-lived token in the URL on 404 or network failure (R8)', async () => {
  setToken('long-lived-secret-key')
  const opened: string[] = []
  g.WebSocket = class FakeWebSocket {
    constructor(url: string) {
      opened.push(url)
    }
  }

  g.fetch = async () => new Response('not found', { status: 404 })
  await openWebSocket('/api/plugins/code/ws/events')

  g.fetch = async () => {
    throw new TypeError('network down')
  }
  await openWebSocket('/api/plugins/code/ws/events')

  assert.deepEqual(opened, [
    'ws://app.test:8080/api/plugins/code/ws/events',
    'ws://app.test:8080/api/plugins/code/ws/events',
  ])
  for (const url of opened) {
    assert.ok(!url.includes('long-lived-secret-key'), `token leaked into URL: ${url}`)
    assert.ok(!url.includes('token='), `token query param leaked into URL: ${url}`)
  }
})

test('openWebSocket never attaches credentials to cross-origin or protocol-relative URLs', async () => {
  setToken('super-secret')
  let fetchCalled = false
  const opened: string[] = []

  g.WebSocket = class FakeWebSocket {
    constructor(url: string) {
      opened.push(url)
    }
  }
  g.fetch = async () => {
    fetchCalled = true
    return new Response(JSON.stringify({ ticket: 'should-not-leak' }), { status: 200 })
  }

  await openWebSocket('wss://other.example/stream')
  await openWebSocket('//evil.example/stream')

  assert.equal(fetchCalled, false)
  assert.deepEqual(opened, ['wss://other.example/stream', 'ws://evil.example/stream'])
})
