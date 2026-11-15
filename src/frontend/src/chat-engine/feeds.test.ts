// npm test -- chat-engine/feeds
// The SessionsFeed and ChatFeed a layout frame reads (ADR 0003 §1.1), and the
// rule that keeps them light: no assistant-ui, Thread, ChatPage or runtime
// hook anywhere in their import graph.
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { createChatFeed, createSessionsFeed, PREFILL_EVENT } from './feeds'
import { resetSessionsForTests, sessionsStore } from './sessionsStore'
import { threadStore } from './store'
import type { AiuiTransport, SendArgs } from './transports'
import type { WireEvent } from './protocol'

const g = globalThis as unknown as Record<string, unknown>
const win = new EventTarget()
g.window = win

type Call = { url: string; method: string; body?: string }
const realFetch = globalThis.fetch
let calls: Call[] = []
let listed: Record<string, unknown>[] = []
const history: Record<string, Record<string, unknown>[]> = {}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  resetSessionsForTests()
  threadStore.reset()
  threadStore.configure({ historyUrl: (sid) => `/hist/${sid}` })
  calls = []
  listed = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined })
    if (url === '/api/sessions') return json({ sessions: listed })
    if (url.startsWith('/hist/')) return json({ messages: history[url.slice(6)] ?? [] })
    if (url.startsWith('/api/approvals/')) return json({ ok: true })
    if (url.startsWith('/sessions/')) return json({ ok: true })
    return json({}, 404)
  }) as typeof fetch
})
afterEach(() => {
  resetSessionsForTests()
  threadStore.reset()
  globalThis.fetch = realFetch
})

const tick = () => new Promise((r) => setTimeout(r, 0))

function fakeTransport() {
  const cancels: string[] = []
  let emit: (ev: WireEvent) => void = () => undefined
  const t: AiuiTransport = {
    kind: 'ws',
    send: (args: SendArgs) =>
      new Promise<void>((resolve) => {
        emit = args.onEvent
        args.signal.addEventListener('abort', () => resolve(), { once: true })
      }),
    async cancel(sid) {
      cancels.push(sid)
    },
    async respondAsk() {},
  }
  return { t, cancels, emit: (ev: WireEvent) => emit(ev) }
}

// ── SessionsFeed ─────────────────────────────────────────────────────

test('sessions: the first subscriber loads the list once; get() keeps its identity until a change', async () => {
  listed = [{ id: 'a', title: 'A', updated_at: 2 }, { id: 'b', title: 'B', updated_at: 1 }]
  const feed = createSessionsFeed()
  const before = feed.get()
  assert.equal(before.loading, true)
  assert.equal(feed.get(), before)
  let n = 0
  const off = feed.subscribe(() => n++)
  const off2 = feed.subscribe(() => undefined)
  await tick()
  await tick()
  assert.equal(calls.filter((c) => c.url === '/api/sessions').length, 1, 'one list request')
  const after = feed.get()
  assert.notEqual(after, before)
  assert.deepEqual(after.sessions.map((s) => s.id), ['a', 'b'])
  assert.equal(after.loading, false)
  assert.equal(after.error, undefined)
  assert.ok(n >= 1)
  off()
  off2()
})

test('sessions: select and create open the chat (show) and move the selection; runningIds follow live turns', async () => {
  const shown: number[] = []
  const feed = createSessionsFeed({ show: () => shown.push(1) })
  feed.select('a')
  assert.equal(feed.get().activeId, 'a')
  feed.create()
  assert.equal(feed.get().activeId, null)
  assert.equal(shown.length, 2)
  const f = fakeTransport()
  void threadStore.send(f.t, 'live', 'hi')
  await tick()
  assert.ok(feed.get().runningIds.has('live'))
  await threadStore.cancel(f.t, 'live')
  assert.equal(feed.get().runningIds.has('live'), false)
})

test('sessions: rename, remove and refresh go through the store', async () => {
  listed = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }]
  const feed = createSessionsFeed()
  await feed.refresh()
  await feed.rename('a', 'Alpha')
  assert.equal(feed.get().sessions.find((s) => s.id === 'a')?.title, 'Alpha')
  sessionsStore.select('b')
  await feed.remove('b')
  assert.ok(calls.some((c) => c.url === '/sessions/b' && c.method === 'DELETE'))
  assert.deepEqual(feed.get().sessions.map((s) => s.id), ['a'])
  assert.equal(feed.get().activeId, null)
})

// ── ChatFeed ─────────────────────────────────────────────────────────

test('chat: the open session’s thread, loaded for a frame; it follows a session switch and stops on unsubscribe', async () => {
  history.one = [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'reply one' }]
  history.two = [{ role: 'user', content: 'second' }]
  const feed = createChatFeed()
  assert.deepEqual(feed.get(), { sessionId: null, messages: [], isRunning: false, activeRunId: undefined })
  sessionsStore.select('one')
  let n = 0
  const off = feed.subscribe(() => n++)
  await tick()
  await tick()
  threadStore.flush()
  const a = feed.get()
  assert.equal(a.sessionId, 'one')
  assert.deepEqual(a.messages.map((m) => m.role), ['user', 'assistant'])
  assert.equal(feed.get(), a, 'stable until a change')
  sessionsStore.select('two')
  await tick()
  await tick()
  threadStore.flush()
  assert.equal(feed.get().sessionId, 'two')
  assert.equal(feed.get().messages.length, 1)
  const seen = n
  off()
  sessionsStore.select('one')
  assert.equal(n, seen, 'no calls after unsubscribe')
})

test('chat: a live turn streams into the feed; cancel stops it through the turn’s transport', async () => {
  const f = fakeTransport()
  sessionsStore.select('s')
  const feed = createChatFeed()
  const off = feed.subscribe(() => undefined)
  void threadStore.send(f.t, 's', 'go')
  await tick()
  f.emit({ type: 'run_started', run_id: 'R9' })
  f.emit({ type: 'token', token: 'Hel' })
  threadStore.flush()
  const live = feed.get()
  assert.equal(live.isRunning, true)
  assert.equal(live.messages.at(-1)?.role, 'assistant')
  await feed.cancel()
  assert.deepEqual(f.cancels, ['s'])
  assert.equal(feed.get().isRunning, false)
  await feed.cancel() // nothing running: no-op
  assert.deepEqual(f.cancels, ['s'])
  off()
})

test('chat: resolveApproval decides a gate of the open chat; one that is not there rejects', async () => {
  const f = fakeTransport()
  sessionsStore.select('s')
  const feed = createChatFeed()
  void threadStore.send(f.t, 's', 'install')
  await tick()
  f.emit({ type: 'run_paused', extra_data: { type: 'approval_required', id: 'ap1', tool_name: 'terminal', arguments: { command: 'pip install numpy' } } })
  threadStore.flush()
  await assert.rejects(feed.resolveApproval('nope', true), /not in the open chat/)
  await feed.resolveApproval('ap1', true)
  assert.ok(calls.some((c) => c.url === '/api/approvals/ap1/approve' && c.method === 'POST'))
  const gate = feed.get().messages.flatMap((m) => m.parts).find((p) => p.type === 'tool-call' && p.approval?.id === 'ap1')
  assert.ok(gate && gate.type === 'tool-call' && gate.approval?.approved === true)
  await threadStore.cancel(f.t, 's')
})

test('chat: resolveApproval passes always through to the gate decision', async () => {
  const f = fakeTransport()
  sessionsStore.select('s')
  const feed = createChatFeed()
  void threadStore.send(f.t, 's', 'install')
  await tick()
  f.emit({ type: 'run_paused', extra_data: { type: 'approval_required', id: 'ap2', tool_name: 'terminal', arguments: { command: 'pip install numpy' } } })
  threadStore.flush()
  await feed.resolveApproval('ap2', true, { always: true })
  const post = calls.find((c) => c.url === '/api/approvals/ap2/approve' && c.method === 'POST')
  assert.ok(post, 'the decision went out')
  assert.equal(JSON.parse(post.body ?? '{}').always, true)
  await threadStore.cancel(f.t, 's')
})

test('chat: send starts a turn in the open chat, or in a new chat it lists and selects; blank text and a running chat do nothing', async () => {
  const f = fakeTransport()
  const sent: SendArgs[] = []
  const t: AiuiTransport = { ...f.t, send: (args) => (sent.push(args), f.t.send(args)) }
  const shown: number[] = []
  const feed = createChatFeed({ show: () => shown.push(1), transport: t })
  assert.equal(typeof feed.send, 'function')

  // No chat open: a new one, listed under its first message and selected.
  const first = feed.send!('Compare sorting algorithms', { agentName: 'Coder' })
  await tick()
  const sid = sessionsStore.get().activeId
  assert.ok(sid, 'a new chat is selected')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].sessionId, sid)
  assert.equal(sent[0].text, 'Compare sorting algorithms')
  assert.equal(sent[0].agentName, 'Coder')
  assert.ok(sessionsStore.get().sessions.some((s) => s.id === sid && s.title === 'Compare sorting algorithms'))
  assert.equal(shown.length, 1)
  assert.equal(feed.get().isRunning, true)

  // While it runs, and for blank text: nothing is sent.
  await feed.send!('again')
  await feed.send!('   ')
  assert.equal(sent.length, 1)
  await threadStore.cancel(t, sid!)
  await first

  // The open chat: the same session.
  void feed.send!('next')
  await tick()
  assert.equal(sent.length, 2)
  assert.equal(sent[1].sessionId, sid)
  await threadStore.cancel(t, sid!)
})

test('chat: prefill opens the chat and hands the text to the composer by the window event', () => {
  const shown: number[] = []
  const got: unknown[] = []
  const on = (e: Event) => got.push((e as CustomEvent).detail)
  win.addEventListener(PREFILL_EVENT, on)
  try {
    const feed = createChatFeed({ show: () => shown.push(1) })
    feed.prefill('Compare the sorts')
    feed.prefill('')
    assert.deepEqual(got, [{ text: 'Compare the sorts' }])
    assert.equal(shown.length, 1)
  } finally {
    win.removeEventListener(PREFILL_EVENT, on)
  }
})

// ── isolation ────────────────────────────────────────────────────────

const SRC = path.resolve(process.cwd(), 'src')

function resolveImport(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec)
  else return null
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
    const file = base + ext
    if (existsSync(file) && statSync(file).isFile()) return file
  }
  return null
}

/** Value imports (not `import type`) of a module and everything they import, inside src/. */
function valueImports(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const walk = (file: string) => {
    if (files.has(file)) return
    files.add(file)
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/^\s*(?:import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)) {
      if (m[1]) continue // import type: erased
      const spec = m[2] ?? m[3]
      const target = resolveImport(file, spec)
      if (target) walk(target)
      else if (!spec.startsWith('.') && !spec.startsWith('@/')) packages.add(spec)
    }
  }
  walk(entry)
  return { files, packages }
}

test('feeds import no assistant-ui, Thread, ChatPage, runtime hook or stylesheet', () => {
  const { files, packages } = valueImports(path.join(SRC, 'chat-engine', 'feeds.ts'))
  const rel = [...files].map((f) => path.relative(SRC, f)).sort()
  assert.ok(rel.includes('chat-engine/sessionsStore.ts') && rel.includes('chat-engine/store.ts'), rel.join(', '))
  for (const banned of ['chat-engine/Thread.tsx', 'chat-engine/ChatPage.tsx', 'chat-engine/useAiuiRuntime.ts', 'chat-engine/convert.ts']) {
    assert.ok(!rel.includes(banned), `${banned} is in the feeds' import graph`)
  }
  assert.ok(rel.every((f) => !f.startsWith('chat-engine/presentation/')), 'no presentation chunk')
  assert.deepEqual([...packages].filter((p) => p.startsWith('@assistant-ui') || p.endsWith('.css')), [])
})
