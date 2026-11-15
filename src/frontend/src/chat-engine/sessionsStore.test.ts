// npm test -- chat-engine/sessionsStore
// The chat's session list and selection as module state (layouts §3), shared
// by the chat page and the SessionsFeed a layout frame reads.
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { resetSessionsForTests, SETTLE_REFRESH_MS, sessionsStore } from './sessionsStore'
import { threadStore } from './store'
import type { AiuiTransport, SendArgs } from './transports'

type Call = { url: string; method: string; body?: string }
const realFetch = globalThis.fetch
let calls: Call[] = []
let listed: Record<string, unknown>[] = []
/** Resolve list requests by hand when set (to order overlapping refreshes). */
let gate: Promise<void> | null = null

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function installFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined })
    if (url === '/api/sessions' && method === 'GET') {
      const snapshot = listed.map((s) => ({ ...s }))
      if (gate) await gate
      return json({ sessions: snapshot })
    }
    if (url.startsWith('/sessions/') && (method === 'PATCH' || method === 'DELETE')) return json({ ok: true })
    return json({}, 404)
  }) as typeof fetch
}

/** A transport whose turns never end on their own. */
function fakeTransport() {
  const cancels: string[] = []
  const t: AiuiTransport = {
    kind: 'ws',
    send: (args: SendArgs) => new Promise<void>((resolve) => args.signal.addEventListener('abort', () => resolve(), { once: true })),
    async cancel(sid) {
      cancels.push(sid)
    },
    async respondAsk() {},
  }
  return { t, cancels }
}

const tick = () => new Promise((r) => setTimeout(r, 0))
const ids = () => sessionsStore.get().sessions.map((s) => s.id)

beforeEach(() => {
  resetSessionsForTests()
  threadStore.reset()
  calls = []
  listed = []
  gate = null
  installFetch()
})
afterEach(() => {
  resetSessionsForTests()
  threadStore.reset()
  globalThis.fetch = realFetch
})

test('refresh lists the server sessions newest first, ends loading, and keeps the snapshot identity until a change', async () => {
  const before = sessionsStore.get()
  assert.equal(before.loading, true)
  assert.equal(sessionsStore.get(), before, 'get() is stable without a change')
  listed = [
    { id: 'old', title: 'Old', updated_at: 1 },
    { id: 'new', title: 'New', updated_at: 2 },
  ]
  await sessionsStore.refresh()
  const after = sessionsStore.get()
  assert.notEqual(after, before)
  assert.deepEqual(ids(), ['new', 'old'])
  assert.equal(after.loading, false)
  assert.equal(after.error, null)
})

test('a failed list keeps the rows and reports an error; the next good list clears it', async () => {
  listed = [{ id: 'a', title: 'A' }]
  await sessionsStore.refresh()
  globalThis.fetch = (async () => {
    throw new TypeError('Failed to fetch')
  }) as typeof fetch
  await sessionsStore.refresh()
  assert.equal(sessionsStore.get().error, 'Chats could not be loaded')
  assert.deepEqual(ids(), ['a'])
  installFetch()
  await sessionsStore.refresh()
  assert.equal(sessionsStore.get().error, null)
})

test('an older list request that finishes last does not overwrite a newer one', async () => {
  let release!: () => void
  gate = new Promise<void>((r) => (release = r))
  listed = [{ id: 'stale', title: 'Stale' }]
  const first = sessionsStore.refresh()
  await tick()
  gate = null
  listed = [{ id: 'fresh', title: 'Fresh' }]
  await sessionsStore.refresh()
  release()
  await first
  assert.deepEqual(ids(), ['fresh'])
})

test('select notifies, counts each change of the selection, and ignores the same id', () => {
  let n = 0
  const off = sessionsStore.subscribe(() => n++)
  const s0 = sessionsStore.get().selection
  sessionsStore.select('a')
  sessionsStore.select('a')
  assert.equal(n, 1)
  assert.equal(sessionsStore.get().activeId, 'a')
  assert.equal(sessionsStore.get().selection, s0 + 1)
  sessionsStore.select(null)
  assert.equal(sessionsStore.get().activeId, null)
  assert.equal(sessionsStore.get().selection, s0 + 2)
  off()
})

test('a chat started here is listed under its first message until the server lists it, and selected', async () => {
  const f = fakeTransport()
  void threadStore.send(f.t, 'S1', 'Compare quicksort,   mergesort and timsort, with a code sample please')
  await tick()
  sessionsStore.noteCreated('S1')
  const snap = sessionsStore.get()
  assert.equal(snap.activeId, 'S1')
  assert.deepEqual(ids(), ['S1'])
  assert.equal(snap.sessions[0].title, 'Compare quicksort, mergesort and timsort, with a code sam…')
  // The server lists it without a title: the local title stands in.
  listed = [{ id: 'S1' }]
  await sessionsStore.refresh()
  assert.deepEqual(ids(), ['S1'])
  assert.match(sessionsStore.get().sessions[0].title, /^Compare quicksort/)
  await threadStore.cancel(f.t, 'S1')
})

test('rename updates the row (also a chat the server has not listed yet)', async () => {
  listed = [{ id: 'a', title: 'A' }]
  await sessionsStore.refresh()
  await sessionsStore.rename('a', 'Renamed')
  assert.equal(sessionsStore.get().sessions[0].title, 'Renamed')
  assert.deepEqual(calls.at(-1), { url: '/sessions/a', method: 'PATCH', body: JSON.stringify({ title: 'Renamed' }) })
})

test('remove stops a live run, deletes, forgets the thread, deselects, and a list fetched before the delete cannot bring it back', async () => {
  const f = fakeTransport()
  listed = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]
  await sessionsStore.refresh()
  sessionsStore.select('a')
  void threadStore.send(f.t, 'a', 'hi')
  await tick()
  assert.equal(threadStore.get('a').isRunning, true)
  // A refresh is in flight with the old list when the delete lands.
  let release!: () => void
  gate = new Promise<void>((r) => (release = r))
  const inFlight = sessionsStore.refresh()
  await tick()
  gate = null
  await sessionsStore.remove('a', f.t)
  assert.deepEqual(f.cancels, ['a'])
  assert.ok(calls.some((c) => c.url === '/sessions/a' && c.method === 'DELETE'))
  assert.equal(threadStore.get('a').isRunning, false)
  assert.equal(sessionsStore.get().activeId, null)
  release()
  await inFlight
  assert.deepEqual(ids(), ['b'])
})

test('while someone listens, a finished turn refreshes the list once, shortly after it settles; with no listener nothing is fetched', async () => {
  const f = fakeTransport()
  const off = sessionsStore.subscribe(() => undefined)
  void threadStore.send(f.t, 'S', 'one')
  await tick()
  await threadStore.cancel(f.t, 'S')
  void threadStore.send(f.t, 'S', 'two')
  await tick()
  await threadStore.cancel(f.t, 'S')
  const lists = () => calls.filter((c) => c.url === '/api/sessions').length
  assert.equal(lists(), 0, 'debounced')
  await new Promise((r) => setTimeout(r, SETTLE_REFRESH_MS + 50))
  assert.equal(lists(), 1)
  off()
  void threadStore.send(f.t, 'S', 'three')
  await tick()
  await threadStore.cancel(f.t, 'S')
  await new Promise((r) => setTimeout(r, SETTLE_REFRESH_MS + 50))
  assert.equal(lists(), 1, 'no listener, no refresh')
  // A listener that comes back watches turns again.
  const again = sessionsStore.subscribe(() => undefined)
  void threadStore.send(f.t, 'S', 'four')
  await tick()
  await threadStore.cancel(f.t, 'S')
  await new Promise((r) => setTimeout(r, SETTLE_REFRESH_MS + 50))
  assert.equal(lists(), 2, 'watching again')
  again()
})
