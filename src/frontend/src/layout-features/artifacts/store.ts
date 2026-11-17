/**
 * The artifacts of each session, memoized: what ./derive finds in the chat,
 * merged with the versions the user made (Restore), plus what the canvas
 * shows (the selected artifact and version, the split pane).
 *
 *   session(sid)              Feed<SessionArtifacts> (useSyncExternalStore-ready)
 *   open(sid, key, v?)        show an artifact (and tell the frame: onOpen, DOM event)
 *   select / setSplit         canvas state
 *   restore(sid, key, v)      a user version with that version's content
 *   ensure(sid)               load a session (its history, its stored versions)
 *
 * Client-only by default. With a backend (the `builtin.artifacts` record is
 * on) it also keeps the server's copy current: it loads the session's
 * stored versions once, and PUTs each derived version once its reply is
 * complete, and each user version as it is made. A session the thread
 * source does not have (the artifacts page showing another chat) shows the
 * stored versions instead of deriving them.
 *
 * Version numbers never depend on clocks. A user version keeps the number
 * it was given (the server's, once stored); derived versions take the
 * numbers the server stored for the same content, and the free numbers
 * around the user versions otherwise, in turn order. So a restore followed
 * by a new reply reads v1, v2, v3 (restored), v4, and a reload (whose
 * history has no message ids or times) shows and stores the same numbers:
 * a derived version is never PUT over a stored one with other content.
 *
 * The thread source and backend are injected (tests); ./feed wires the
 * `chat` layout feed and ./api.
 */
import type { Artifact, Feed } from '@/sdk/layoutTypes'
import type { ArtifactPut } from './api'
import { putBody } from './api'
import { deriveArtifacts, parseTable, type DeriveMessage, type DeriveOptions, type DerivedArtifact } from './derive'
import { lineCount } from './format'

export interface ThreadView {
  messages: readonly DeriveMessage[]
  isRunning: boolean
}

export interface ThreadSource {
  get(sessionId: string | null): ThreadView
  subscribe(sessionId: string | null, fn: () => void): () => void
  /** Load a session's persisted history (once). */
  load?(sessionId: string): Promise<void>
}

export interface ArtifactsBackend {
  /** Read at call time: the record may be on or off. */
  enabled(): boolean
  fetchSession(sessionId: string): Promise<Artifact[]>
  put(sessionId: string, key: string, body: ArtifactPut): Promise<Artifact>
}

export interface Selection {
  key: string
  /** A pinned older version; absent: the latest. */
  version?: number
}

export type ServerState = 'off' | 'loading' | 'ready' | 'error'

export interface SessionArtifacts {
  sessionId: string | null
  /** Every version, grouped by key in first-appearance order, oldest first. */
  versions: readonly DerivedArtifact[]
  /** The latest version of every key, in first-appearance order. */
  latest: readonly DerivedArtifact[]
  /** messageId → the versions that reply showed. */
  mentions: Readonly<Record<string, readonly DerivedArtifact[]>>
  /** What the canvas shows: the chosen artifact and version, else the newest. */
  selected: DerivedArtifact | null
  /** The artifact in the split pane (its latest version), if any. */
  split: DerivedArtifact | null
  running: boolean
  server: ServerState
}

export interface OpenRequest {
  sessionId: string
  key: string
  version?: number
}

/** Dispatched on window by open(): a frame shows its canvas (e.g. the phone switch). */
export const OPEN_EVENT = 'aiui:artifact-open'
/** The chat's aside event (chat-engine/presentation/Aside ASIDE_EVENT): open() also brings the canvas up. */
export const ASIDE_EVENT = 'aiui:chat-aside'

export interface ArtifactsStore {
  session(sessionId: string | null): Feed<SessionArtifacts>
  open(sessionId: string, key: string, version?: number): void
  select(sessionId: string | null, key: string, version?: number): void
  setSplit(sessionId: string | null, key: string | null): void
  restore(sessionId: string | null, key: string, version: number): DerivedArtifact | null
  ensure(sessionId: string): Promise<void>
  onOpen(fn: (req: OpenRequest) => void): () => void
  /** Every session this tab has seen artifacts in (the artifacts page, client-only). */
  knownSessions(): string[]
}

/** Lines, rows and columns of a stored version (the server keeps only what the client sent). */
export function measure(a: Artifact): DerivedArtifact {
  const out: DerivedArtifact = { ...a }
  if (a.kind === 'table' && a.content) {
    const t = parseTable(a.content)
    out.rows = t.rows.length
    out.columns = t.header
  } else if ((a.kind === 'code' || a.kind === 'markdown') && a.content !== undefined) {
    out.lines = lineCount(a.content)
  }
  return out
}

/** What the server would keep of a version's payload: its text (within the limit), else its URL. */
function payload(a: Pick<DerivedArtifact, 'kind' | 'content' | 'url'>): string | null {
  const b = putBody(a, true)
  return b.content ?? b.url ?? null
}

/**
 * Whether a stored derived version is this derived one: the same reply
 * (message id), or the same payload. A history reload gives messages new
 * ids (h_0…), so the payload decides there.
 */
export function sameVersion(stored: Pick<DerivedArtifact, 'kind' | 'content' | 'url' | 'messageId'>, d: Pick<DerivedArtifact, 'kind' | 'content' | 'url' | 'messageId'>): boolean {
  return (!!stored.messageId && stored.messageId === d.messageId) || payload(stored) === payload(d)
}

/**
 * Derived and user versions of every key, numbered; `mentions` re-pointed
 * at the numbered objects. Pure.
 *
 * - A user version keeps its `version` (the server assigned it, or restore
 *   did locally until the server answers).
 * - A derived version takes the number of the stored derived version that
 *   is the same (sameVersion), the next one after its predecessor's;
 *   otherwise the first number after its predecessor that no user version,
 *   stored version or earlier derived version holds.
 * Timestamps play no part: after a reload every history message has the
 * same `createdAt`, and the order of turns is all that is known.
 */
export function mergeVersions(
  derived: readonly DerivedArtifact[],
  user: readonly DerivedArtifact[],
  mentions: Record<string, DerivedArtifact[]>,
  stored: readonly DerivedArtifact[] = [],
): { versions: DerivedArtifact[]; mentions: Record<string, DerivedArtifact[]> } {
  if (!user.length && !stored.length) return { versions: [...derived], mentions }
  const order: string[] = []
  const group = <T>(list: readonly T[], keyOf: (a: T) => string, track: boolean) => {
    const m = new Map<string, T[]>()
    for (const a of list) {
      const k = keyOf(a)
      if (!m.has(k)) {
        m.set(k, [])
        if (track && !order.includes(k)) order.push(k)
      }
      m.get(k)!.push(a)
    }
    return m
  }
  const derivedBy = group(derived, (a) => a.key, true)
  const userBy = group(user, (a) => a.key, true)
  const storedBy = group(stored.filter((a) => !a.edited), (a) => a.key, false)
  const renamed = new Map<DerivedArtifact, DerivedArtifact>()
  const versions: DerivedArtifact[] = []
  for (const key of order) {
    const mine = userBy.get(key) ?? []
    const anchors = [...(storedBy.get(key) ?? [])].sort((x, y) => x.version - y.version)
    const held = new Set<number>([...mine.map((u) => u.version), ...anchors.map((a) => a.version)])
    const userNums = new Set(mine.map((u) => u.version))
    const used = new Set<number>()
    const out: DerivedArtifact[] = [...mine]
    let prev = 0
    for (const a of derivedBy.get(key) ?? []) {
      const match = anchors.find((s) => s.version > prev && !used.has(s.version) && !userNums.has(s.version) && sameVersion(s, a))
      let n = match?.version ?? prev + 1
      if (!match) while (held.has(n) || used.has(n)) n++
      used.add(n)
      prev = n
      const v = a.version === n ? a : { ...a, version: n }
      renamed.set(a, v)
      out.push(v)
    }
    versions.push(...out.sort((x, y) => x.version - y.version))
  }
  const re: Record<string, DerivedArtifact[]> = {}
  for (const [id, list] of Object.entries(mentions)) re[id] = list.map((a) => renamed.get(a) ?? a)
  return { versions, mentions: re }
}

function latestOf(versions: readonly DerivedArtifact[]): DerivedArtifact[] {
  const by = new Map<string, DerivedArtifact>()
  for (const v of versions) by.set(v.key, v)
  return [...by.values()]
}

/** The newest version overall (updatedAt, then position). */
function newest(latest: readonly DerivedArtifact[]): DerivedArtifact | null {
  let best: DerivedArtifact | null = null
  for (const a of latest) {
    const d = (a.updatedAt ?? 0) - (best?.updatedAt ?? 0)
    // A tie is one reply that made both: the code goes below in the split (autoSplit), the other is shown.
    if (!best || d > 0 || (d === 0 && !(a.kind === 'code' && best.kind !== 'code'))) best = a
  }
  return best
}

/** No split chosen yet: the newest code docks below a table or document (the design's table over sort_demo.py). */
function autoSplit(latest: readonly DerivedArtifact[], selected: DerivedArtifact | null): string | null {
  if (!selected || selected.kind === 'code') return null
  return newest(latest.filter((a) => a.kind === 'code'))?.key ?? null
}

interface SessionState {
  sid: string | null
  user: (DerivedArtifact & { persisted?: boolean })[]
  selection: (Selection & { seen: number }) | null
  /** undefined: not chosen (autoSplit); null: closed. */
  split: string | null | undefined
  server: ServerState
  /** `key@version` → the derived version the server has under that number. */
  known: Map<string, DerivedArtifact>
  inflight: Set<string>
  /** PUTs that failed: not retried until the page reloads. */
  failed: Set<string>
  listeners: Set<() => void>
  unsubscribe: (() => void) | null
  syncTimer: ReturnType<typeof setTimeout> | null
  /** Every PUT runs in this chain, one at a time, so a restore is stored after the derived versions before it. */
  queue: Promise<void>
  /** Derived versions as the server stored them (shown when the chat is not here). */
  stored: DerivedArtifact[]
  loading: Promise<void> | null
  memo: { messages: readonly DeriveMessage[]; user: unknown; stored: unknown; selection: unknown; split: unknown; server: ServerState; running: boolean; snap: SessionArtifacts } | null
  feed: Feed<SessionArtifacts> | null
}

const syncId = (a: Pick<DerivedArtifact, 'key' | 'version' | 'messageId'>) => `${a.key}@${a.version}@${a.messageId}`
const slot = (a: Pick<DerivedArtifact, 'key' | 'version'>) => `${a.key}@${a.version}`

export interface StoreOptions {
  threads: ThreadSource
  backend?: ArtifactsBackend
  derive?: DeriveOptions
  /** Defaults to Date.now (tests). */
  now?: () => number
}

export function createArtifactsStore({ threads, backend, derive = {}, now = Date.now }: StoreOptions): ArtifactsStore {
  const sessions = new Map<string, SessionState>()
  const openFns = new Set<(req: OpenRequest) => void>()
  const NULL = '\0new'

  const state = (sid: string | null): SessionState => {
    const k = sid ?? NULL
    let s = sessions.get(k)
    if (!s) {
      s = {
        sid,
        user: [],
        selection: null,
        split: undefined,
        server: 'off',
        known: new Map(),
        inflight: new Set(),
        failed: new Set(),
        stored: [],
        loading: null,
        listeners: new Set(),
        unsubscribe: null,
        syncTimer: null,
        queue: Promise.resolve(),
        memo: null,
        feed: null,
      }
      sessions.set(k, s)
    }
    return s
  }

  const serverOn = (s: SessionState) => !!s.sid && !!backend?.enabled()

  function compute(s: SessionState): SessionArtifacts {
    const thread = threads.get(s.sid)
    const m = s.memo
    if (m && m.messages === thread.messages && m.user === s.user && m.stored === s.stored && m.selection === s.selection && m.split === s.split && m.server === s.server && m.running === thread.isRunning) {
      return m.snap
    }
    const fromChat = deriveArtifacts(thread.messages, s.sid, derive)
    // No chat for this session here (another chat on the artifacts page): what the server stored.
    const d = fromChat.versions.length || !s.stored.length ? fromChat : { versions: s.stored, mentions: {} }
    const { versions, mentions } = mergeVersions(d.versions, s.user, d.mentions, s.stored)
    const latest = latestOf(versions)
    // A new version while a reply runs is the agent showing something: follow it.
    if (s.selection && thread.isRunning && versions.length > s.selection.seen) s.selection = null
    let selected: DerivedArtifact | null = null
    if (s.selection) {
      const sel = s.selection
      const all = versions.filter((v) => v.key === sel.key)
      selected = (sel.version !== undefined ? all.find((v) => v.version === sel.version) : undefined) ?? all[all.length - 1] ?? null
    }
    selected ??= newest(latest)
    const splitKey = s.split === undefined ? autoSplit(latest, selected) : s.split
    const split = splitKey ? (latest.find((a) => a.key === splitKey && a.key !== selected?.key) ?? null) : null
    const snap: SessionArtifacts = { sessionId: s.sid, versions, latest, mentions, selected, split, running: thread.isRunning, server: s.server }
    s.memo = { messages: thread.messages, user: s.user, stored: s.stored, selection: s.selection, split: s.split, server: s.server, running: thread.isRunning, snap }
    return snap
  }

  const notify = (s: SessionState) => {
    for (const fn of [...s.listeners]) fn()
  }

  // ── server sync ──────────────────────────────────────────────────

  function loadServer(s: SessionState): Promise<void> {
    if (!serverOn(s)) return Promise.resolve()
    if (s.server !== 'loading' || !s.loading) s.loading = fetchServer(s)
    return s.loading
  }

  async function fetchServer(s: SessionState) {
    s.server = 'loading'
    notify(s)
    try {
      const stored = await backend!.fetchSession(s.sid!)
      s.stored = stored.filter((a) => !a.edited).map(measure)
      s.known = new Map(s.stored.map((a) => [slot(a), a]))
      const local = s.user.filter((u) => !u.persisted)
      s.user = [...stored.filter((a) => a.edited).map((a) => ({ ...measure(a), persisted: true })), ...local]
      s.server = 'ready'
    } catch (err) {
      console.debug('[aiui artifacts] could not load the stored artifacts; working from the chat', err)
      s.server = 'error'
    }
    notify(s)
    scheduleSync(s)
  }

  function scheduleSync(s: SessionState) {
    if (s.server !== 'ready' || s.syncTimer) return
    s.syncTimer = setTimeout(() => {
      s.syncTimer = null
      void enqueue(s, () => sync(s))
    }, 0)
  }

  function enqueue(s: SessionState, job: () => Promise<void>): Promise<void> {
    s.queue = s.queue.then(job, job).catch((err: unknown) => console.debug('[aiui artifacts] sync failed', err))
    return s.queue
  }

  async function sync(s: SessionState) {
    if (s.server !== 'ready' || !serverOn(s)) return
    const snap = compute(s)
    if (snap.running) return
    for (const v of snap.versions) {
      if (v.edited) continue
      const has = s.known.get(slot(v))
      if (has && sameVersion(has, v)) continue
      const id = syncId(v)
      if (s.inflight.has(id) || s.failed.has(id)) continue
      s.inflight.add(id)
      try {
        await backend!.put(s.sid!, v.key, putBody(v, true))
        s.known.set(slot(v), v)
      } catch (err) {
        s.failed.add(id) // never retried in this tab, so a reload cannot loop
        if ((err as { status?: number }).status === 409) {
          // The user edited that version number elsewhere: reload and renumber.
          s.inflight.delete(id)
          void loadServer(s)
          return
        }
        console.debug('[aiui artifacts] could not store an artifact version', err)
      } finally {
        s.inflight.delete(id)
      }
    }
  }

  function attach(s: SessionState) {
    s.unsubscribe = threads.subscribe(s.sid, () => {
      notify(s)
      scheduleSync(s)
    })
    if (serverOn(s) && s.server === 'off') void loadServer(s)
  }

  function feedOf(s: SessionState): Feed<SessionArtifacts> {
    s.feed ??= {
      get: () => compute(s),
      subscribe(fn) {
        s.listeners.add(fn)
        if (!s.unsubscribe) attach(s)
        return () => {
          s.listeners.delete(fn)
          if (!s.listeners.size && s.unsubscribe) {
            s.unsubscribe()
            s.unsubscribe = null
            if (s.syncTimer) clearTimeout(s.syncTimer)
            s.syncTimer = null
          }
        }
      },
    }
    return s.feed
  }

  function select(sid: string | null, key: string, version?: number) {
    const s = state(sid)
    const seen = compute(s).versions.length
    s.selection = { key, version, seen }
    notify(s)
  }

  return {
    session: (sid) => feedOf(state(sid)),
    select,
    open(sid, key, version) {
      select(sid, key, version)
      const req: OpenRequest = { sessionId: sid, key, ...(version !== undefined ? { version } : {}) }
      for (const fn of [...openFns]) fn(req)
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: req }))
        window.dispatchEvent(new CustomEvent(ASIDE_EVENT, { detail: { open: true } }))
      }
    },
    setSplit(sid, key) {
      const s = state(sid)
      s.split = key
      notify(s)
    },
    restore(sid, key, version) {
      const s = state(sid)
      const from = compute(s).versions.find((v) => v.key === key && v.version === version)
      if (!from) return null
      const snap = compute(s)
      // After every number shown or stored for this key (the server picks its own: adopted below).
      const top = Math.max(0, ...snap.versions.filter((a) => a.key === key).map((a) => a.version), ...s.stored.filter((a) => a.key === key).map((a) => a.version))
      const latest = snap.latest.find((a) => a.key === key)
      const v: DerivedArtifact & { persisted?: boolean } = {
        ...from,
        version: top + 1,
        edited: true,
        restoredFrom: version,
        updatedAt: Math.max(now(), (latest?.updatedAt ?? 0) + 1),
      }
      delete v.agent
      s.user = [...s.user, v]
      s.selection = { key, seen: compute(s).versions.length }
      notify(s)
      if (serverOn(s)) {
        // The derived versions before it first, so the server numbers it after them.
        void enqueue(s, () => sync(s))
        void enqueue(s, async () => {
          try {
            const saved = await backend!.put(s.sid!, key, putBody(v, true))
            const n = saved?.version
            const kept: DerivedArtifact & { persisted?: boolean } = { ...v, persisted: true, ...(typeof n === 'number' && Number.isInteger(n) && n >= 1 ? { version: n } : {}) }
            s.user = s.user.map((u) => (u === v ? kept : u))
            notify(s)
          } catch (err) {
            console.debug('[aiui artifacts] could not store the restored version', err)
          }
        })
      }
      return compute(s).versions.find((a) => a.key === key && a.edited && a.updatedAt === v.updatedAt) ?? null
    },
    async ensure(sid) {
      const s = state(sid)
      await Promise.all([threads.load?.(sid), serverOn(s) && (s.server === 'off' || s.server === 'error') ? loadServer(s) : null])
    },
    onOpen(fn) {
      openFns.add(fn)
      return () => {
        openFns.delete(fn)
      }
    },
    knownSessions: () => [...sessions.values()].map((s) => s.sid).filter((sid): sid is string => !!sid && compute(state(sid)).latest.length > 0),
  }
}
