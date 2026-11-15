// The per-session artifacts store: memoized snapshots, selection and split,
// restore, open events, and the server sync (client-only when it is off).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Artifact } from '@/sdk/layoutTypes'
import type { ArtifactPut } from './api'
import type { DeriveMessage, DerivedArtifact } from './derive'
import { reply, sortingConversation, T0 } from './fixtures'
import { createArtifactsStore, measure, mergeVersions, type ArtifactsBackend, type ThreadSource, type ThreadView } from './store'

function threads(initial: Record<string, DeriveMessage[]> = {}) {
  const data = new Map<string | null, ThreadView>(Object.entries(initial).map(([k, v]) => [k, { messages: v, isRunning: false }]))
  const fns = new Map<string | null, Set<() => void>>()
  const loads: string[] = []
  const src: ThreadSource & { set(sid: string, view: Partial<ThreadView>): void; listeners(sid: string): number; loads: string[] } = {
    loads,
    get: (sid) => data.get(sid) ?? { messages: [], isRunning: false },
    subscribe(sid, fn) {
      if (!fns.has(sid)) fns.set(sid, new Set())
      fns.get(sid)!.add(fn)
      return () => fns.get(sid)!.delete(fn)
    },
    async load(sid) {
      loads.push(sid)
    },
    set(sid, view) {
      data.set(sid, { ...src.get(sid), ...view })
      for (const fn of fns.get(sid) ?? []) fn()
    },
    listeners: (sid) => fns.get(sid)?.size ?? 0,
  }
  return src
}

function backend(stored: Artifact[] = [], opts: { on?: boolean; fail?: (key: string) => number | undefined } = {}) {
  const puts: { sid: string; key: string; body: ArtifactPut }[] = []
  const fetches: string[] = []
  const b: ArtifactsBackend & { puts: typeof puts; fetches: string[]; on: boolean } = {
    puts,
    fetches,
    on: opts.on ?? true,
    enabled: () => b.on,
    async fetchSession(sid) {
      fetches.push(sid)
      return stored
    },
    async put(sid, key, body) {
      const status = opts.fail?.(key)
      if (status) throw Object.assign(new Error('nope'), { status })
      puts.push({ sid, key, body })
      return { key, sessionId: sid, messageId: body.messageId ?? '', title: body.title ?? key, kind: body.kind, version: body.version ?? 99 }
    },
  }
  return b
}

const tick = () => new Promise((r) => setTimeout(r, 5))
const titles = (list: readonly DerivedArtifact[]) => list.map((a) => `${a.title} v${a.version}${a.edited ? ' (edited)' : ''}`)

test('a session snapshot: versions, latest, mentions, newest selected; memoized until the thread changes', () => {
  const t = threads({ s1: sortingConversation() })
  const store = createArtifactsStore({ threads: t })
  const feed = store.session('s1')
  const snap = feed.get()
  assert.deepEqual(titles(snap.versions), ['Comparison table v1', 'Comparison table v2', 'sort_demo.py v1'])
  assert.deepEqual(titles(snap.latest), ['Comparison table v2', 'sort_demo.py v1'])
  assert.equal(snap.selected?.title, 'Comparison table', 'the newest version (the second reply) is shown')
  assert.equal(snap.selected?.version, 2)
  assert.equal(snap.server, 'off')
  assert.equal(feed.get(), snap, 'same object until something changes')
  assert.equal(store.session('s1'), feed, 'one feed per session')
  assert.deepEqual(store.session(null).get().latest, [])
})

test('select, pin a version, split; a new version during a run takes over the canvas', () => {
  const msgs = sortingConversation()
  const t = threads({ s1: msgs })
  const store = createArtifactsStore({ threads: t })
  const feed = store.session('s1')
  const off = feed.subscribe(() => {})
  store.select('s1', 'sort_demo.py')
  assert.equal(feed.get().selected?.key, 'sort_demo.py')
  store.select('s1', 'table:algorithm|average|worst', 1)
  assert.equal(feed.get().selected?.version, 1)
  store.setSplit('s1', 'sort_demo.py')
  assert.equal(feed.get().split?.key, 'sort_demo.py')
  store.setSplit('s1', 'table:algorithm|average|worst')
  assert.equal(feed.get().split, null, 'the selected artifact is never also the split one')
  // A reply streaming a new artifact: the canvas follows it.
  const live = reply('```python title="bench.py"\nimport timeit\nprint(1)\nprint(2)', T0 + 200_000, { completedAt: undefined })
  t.set('s1', { messages: [...msgs, live], isRunning: true })
  assert.equal(feed.get().selected?.key, 'bench.py')
  assert.equal(feed.get().running, true)
  off()
})

test('restore adds a user version after the others; a later reply numbers after it', () => {
  const msgs = sortingConversation()
  const t = threads({ s1: msgs })
  let clock = T0 + 500_000
  const store = createArtifactsStore({ threads: t, now: () => clock })
  const key = 'table:algorithm|average|worst'
  const restored = store.restore('s1', key, 1)
  assert.equal(restored?.version, 3)
  assert.equal(restored?.edited, true)
  assert.equal(restored?.restoredFrom, 1)
  assert.equal(restored?.agent, undefined)
  const snap = store.session('s1').get()
  assert.deepEqual(titles(snap.versions.filter((v) => v.key === key)), ['Comparison table v1', 'Comparison table v2', 'Comparison table v3 (edited)'])
  assert.equal(snap.selected?.version, 3)
  assert.equal(snap.selected?.content, snap.versions[0].content, 'v3 has v1 content')
  clock += 1000
  const next = reply('**Comparison table**\n\n| Algorithm | Average |\n|---|---|\n| Heapsort | n log n |\n| Bubble | n² |', T0 + 600_000)
  t.set('s1', { messages: [...msgs, next] })
  assert.deepEqual(titles(store.session('s1').get().versions.filter((v) => v.key === key)).slice(2), ['Comparison table v3 (edited)', 'Comparison table v4'])
  assert.equal(store.restore('s1', key, 42), null)
})

test('open: selects, tells listeners and dispatches the DOM event', () => {
  const g = globalThis as unknown as Record<string, unknown>
  const events: unknown[] = []
  const previous = g.window
  g.window = new EventTarget()
  const onEvent = (e: Event) => events.push((e as CustomEvent).detail)
  window.addEventListener('aiui:artifact-open', onEvent)
  try {
    const store = createArtifactsStore({ threads: threads({ s1: sortingConversation() }) })
    const got: unknown[] = []
    const off = store.onOpen((r) => got.push(r))
    store.open('s1', 'sort_demo.py')
    off()
    store.open('s1', 'table:algorithm|average|worst', 1)
    assert.deepEqual(got, [{ sessionId: 's1', key: 'sort_demo.py' }])
    assert.deepEqual(events, [{ sessionId: 's1', key: 'sort_demo.py' }, { sessionId: 's1', key: 'table:algorithm|average|worst', version: 1 }])
    assert.equal(store.session('s1').get().selected?.version, 1)
  } finally {
    window.removeEventListener('aiui:artifact-open', onEvent)
    g.window = previous
  }
})

test('subscribe follows the thread; the last unsubscribe lets go of it', () => {
  const t = threads({ s1: [] })
  const store = createArtifactsStore({ threads: t })
  const feed = store.session('s1')
  let calls = 0
  const off = feed.subscribe(() => calls++)
  assert.equal(t.listeners('s1'), 1)
  t.set('s1', { messages: sortingConversation() })
  assert.equal(calls, 1)
  assert.equal(feed.get().latest.length, 2)
  off()
  assert.equal(t.listeners('s1'), 0)
})

test('client only: no backend, or a backend that is off, makes no request', async () => {
  const b = backend([], { on: false })
  const t = threads({ s1: sortingConversation() })
  const store = createArtifactsStore({ threads: t, backend: b })
  const off = store.session('s1').subscribe(() => {})
  t.set('s1', { messages: [...sortingConversation()] })
  await tick()
  store.restore('s1', 'sort_demo.py', 1)
  await tick()
  assert.deepEqual(b.fetches, [])
  assert.deepEqual(b.puts, [])
  assert.equal(store.session('s1').get().server, 'off')
  off()
})

test('server on: loads stored versions once, PUTs derived versions without text, skips what it has', async () => {
  const msgs = sortingConversation()
  const stored: Artifact[] = [
    // Already on the server: the first table version.
    { key: 'table:algorithm|average|worst', kind: 'table', title: 'Comparison table', version: 1, sessionId: 's1', messageId: msgs[1].id },
    // A user version made elsewhere, after everything.
    { key: 'sort_demo.py', kind: 'code', title: 'sort_demo.py', version: 2, sessionId: 's1', messageId: msgs[1].id, edited: true, content: 'print(2)', updatedAt: T0 + 900_000 },
  ]
  const b = backend(stored)
  const t = threads({ s1: msgs })
  const store = createArtifactsStore({ threads: t, backend: b })
  const feed = store.session('s1')
  const off = feed.subscribe(() => {})
  assert.equal(feed.get().server, 'loading')
  await tick()
  assert.deepEqual(b.fetches, ['s1'])
  const snap = feed.get()
  assert.equal(snap.server, 'ready')
  assert.deepEqual(titles(snap.versions), ['Comparison table v1', 'Comparison table v2', 'sort_demo.py v1', 'sort_demo.py v2 (edited)'])
  assert.equal(snap.versions[3].lines, 1, 'stored text is measured')
  assert.deepEqual(
    b.puts.map((p) => [p.key, p.body]),
    [
      ['table:algorithm|average|worst', { kind: 'table', title: 'Comparison table', messageId: msgs[3].id, version: 2 }],
      ['sort_demo.py', { kind: 'code', title: 'sort_demo.py', messageId: msgs[1].id, language: 'python', version: 1 }],
    ],
  )
  // A running reply is not stored until it completes; then only the new version is.
  const live = reply('```python title="bench.py"\na\nb\nc\n```', T0 + 950_000)
  t.set('s1', { messages: [...msgs, live], isRunning: true })
  await tick()
  assert.equal(b.puts.length, 2)
  t.set('s1', { isRunning: false })
  await tick()
  assert.deepEqual(b.puts.slice(2).map((p) => p.key), ['bench.py'])
  // A restore stores the user version with its text and no number.
  store.restore('s1', 'bench.py', 1)
  await tick()
  assert.deepEqual(b.puts[3], { sid: 's1', key: 'bench.py', body: { kind: 'code', title: 'bench.py', messageId: live.id, language: 'python', edited: true, content: 'a\nb\nc' } })
  off()
})

test('server errors: a failed load keeps the chat artifacts; a 409 reloads and renumbers', async () => {
  const t = threads({ s1: sortingConversation() })
  const failing: ArtifactsBackend = { enabled: () => true, fetchSession: async () => Promise.reject(new Error('500')), put: async () => Promise.reject(new Error('x')) }
  const debug = console.debug
  console.debug = () => {}
  try {
    const s1 = createArtifactsStore({ threads: t, backend: failing })
    const off = s1.session('s1').subscribe(() => {})
    await tick()
    assert.equal(s1.session('s1').get().server, 'error')
    assert.equal(s1.session('s1').get().latest.length, 2)
    off()

    const b = backend([], { fail: (key) => (key === 'sort_demo.py' ? 409 : undefined) })
    const s2 = createArtifactsStore({ threads: t, backend: b })
    const off2 = s2.session('s1').subscribe(() => {})
    await tick()
    await tick()
    assert.equal(b.fetches.length, 2, 'the 409 reloaded the stored versions')
    assert.equal(b.puts.filter((p) => p.key === 'sort_demo.py').length, 0)
    off2()
  } finally {
    console.debug = debug
  }
})

test('ensure loads history; knownSessions lists sessions with artifacts', async () => {
  const t = threads({ s1: sortingConversation(), s2: [] })
  const store = createArtifactsStore({ threads: t })
  await store.ensure('s9')
  assert.deepEqual(t.loads, ['s9'])
  store.session('s1').get()
  store.session('s2').get()
  assert.deepEqual(store.knownSessions(), ['s1'])
})

test('mergeVersions and measure', () => {
  const d = (key: string, version: number, updatedAt: number): DerivedArtifact => ({ key, kind: 'code', title: key, version, sessionId: 's', messageId: `m${updatedAt}`, updatedAt })
  const a1 = d('a', 1, 10)
  const a2 = d('a', 2, 30)
  const u = { ...d('a', 9, 20), edited: true }
  const out = mergeVersions([a1, a2], [u], { m30: [a2] })
  assert.deepEqual(out.versions.map((v) => [v.version, v.updatedAt, !!v.edited]), [
    [1, 10, false],
    [2, 20, true],
    [3, 30, false],
  ])
  assert.equal(out.mentions.m30[0].version, 3, 'mentions follow the renumbering')
  assert.equal(mergeVersions([a1], [], {}).versions[0], a1)
  const t = measure({ key: 't', kind: 'table', title: 't', version: 1, sessionId: 's', messageId: '', content: '| a | b |\n|---|---|\n| 1 | 2 |' })
  assert.deepEqual([t.rows, t.columns], [1, ['a', 'b']])
})
