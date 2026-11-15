/**
 * The artifacts of each session, memoized: what ./derive finds in the chat,
 * merged with the versions the user made (Restore), plus what the canvas
 * shows (the selected artifact and version, the split pane).
 *
 *   session(sid)              Feed<SessionArtifacts> (useSyncExternalStore-ready)
 *   open(sid, key, v?)        show an artifact (and tell the frame: onOpen, DOM event)
 *   select / setSplit         canvas state
 *   restore(sid, key, v)      a user version with that version's content
 *   ensure(sid)               load a session's history (the artifacts page)
 *
 * Client-only by default. With a backend (the `builtin.artifacts` record is
 * on) it also keeps the server's index current: it loads the session's
 * stored versions once (user versions come back with their text), and PUTs
 * each derived version without its text (the chat history has it) once its
 * reply is complete, and each user version with its text.
 *
 * Version numbers are the order in time of every version of a key, derived
 * and user-made together, so a restore followed by a new reply reads
 * v1, v2 (restored), v3.
 *
 * The thread source and backend are injected (tests); ./feed wires the chat
 * store and ./api.
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

/**
 * Derived and user versions of every key, in time order and numbered 1..n
 * per key; `mentions` re-pointed at the numbered objects. Pure.
 */
export function mergeVersions(
  derived: readonly DerivedArtifact[],
  user: readonly DerivedArtifact[],
  mentions: Record<string, DerivedArtifact[]>,
): { versions: DerivedArtifact[]; mentions: Record<string, DerivedArtifact[]> } {
  if (!user.length) return { versions: [...derived], mentions }
  const order: string[] = []
  const groups = new Map<string, DerivedArtifact[]>()
  for (const a of [...derived, ...user]) {
    if (!groups.has(a.key)) {
      groups.set(a.key, [])
      order.push(a.key)
    }
    groups.get(a.key)!.push(a)
  }
  const renamed = new Map<DerivedArtifact, DerivedArtifact>()
  const versions: DerivedArtifact[] = []
  for (const key of order) {
    // Stable sort: derived versions keep their order; a user version goes after everything older.
    const list = [...groups.get(key)!].map((a, i) => ({ a, i })).sort((x, y) => (x.a.updatedAt ?? 0) - (y.a.updatedAt ?? 0) || x.i - y.i)
    list.forEach(({ a }, n) => {
      const v = a.version === n + 1 ? a : { ...a, version: n + 1 }
      renamed.set(a, v)
      versions.push(v)
    })
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
  for (const a of latest) if (!best || (a.updatedAt ?? 0) >= (best.updatedAt ?? 0)) best = a
  return best
}

interface SessionState {
  sid: string | null
  user: (DerivedArtifact & { persisted?: boolean })[]
  selection: (Selection & { seen: number }) | null
  split: string | null
  server: ServerState
  /** `key@version@messageId` the server already has. */
  known: Set<string>
  inflight: Set<string>
  /** PUTs that failed: not retried until the page reloads. */
  failed: Set<string>
  listeners: Set<() => void>
  unsubscribe: (() => void) | null
  syncTimer: ReturnType<typeof setTimeout> | null
  memo: { messages: readonly DeriveMessage[]; user: unknown; selection: unknown; split: unknown; server: ServerState; running: boolean; snap: SessionArtifacts } | null
  feed: Feed<SessionArtifacts> | null
}

const syncId = (a: Pick<DerivedArtifact, 'key' | 'version' | 'messageId'>) => `${a.key}@${a.version}@${a.messageId}`

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
        split: null,
        server: 'off',
        known: new Set(),
        inflight: new Set(),
        failed: new Set(),
        listeners: new Set(),
        unsubscribe: null,
        syncTimer: null,
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
    if (m && m.messages === thread.messages && m.user === s.user && m.selection === s.selection && m.split === s.split && m.server === s.server && m.running === thread.isRunning) {
      return m.snap
    }
    const d = deriveArtifacts(thread.messages, s.sid, derive)
    const { versions, mentions } = mergeVersions(d.versions, s.user, d.mentions)
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
    const split = s.split ? (latest.find((a) => a.key === s.split && a.key !== selected?.key) ?? null) : null
    const snap: SessionArtifacts = { sessionId: s.sid, versions, latest, mentions, selected, split, running: thread.isRunning, server: s.server }
    s.memo = { messages: thread.messages, user: s.user, selection: s.selection, split: s.split, server: s.server, running: thread.isRunning, snap }
    return snap
  }

  const notify = (s: SessionState) => {
    for (const fn of [...s.listeners]) fn()
  }

  // ── server sync ──────────────────────────────────────────────────

  async function loadServer(s: SessionState) {
    if (!serverOn(s) || s.server === 'loading') return
    s.server = 'loading'
    notify(s)
    try {
      const stored = await backend!.fetchSession(s.sid!)
      s.known = new Set(stored.filter((a) => !a.edited).map(syncId))
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
      void sync(s)
    }, 0)
  }

  async function sync(s: SessionState) {
    if (s.server !== 'ready' || !serverOn(s)) return
    const snap = compute(s)
    if (snap.running) return
    for (const v of snap.versions) {
      if (v.edited) continue
      const id = syncId(v)
      if (s.known.has(id) || s.inflight.has(id) || s.failed.has(id)) continue
      s.inflight.add(id)
      try {
        await backend!.put(s.sid!, v.key, putBody(v, false))
        s.known.add(id)
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
      const latest = compute(s).latest.find((a) => a.key === key)
      const v: DerivedArtifact & { persisted?: boolean } = {
        ...from,
        // Numbered by mergeVersions; after everything else in time.
        version: (latest?.version ?? version) + 1,
        edited: true,
        restoredFrom: version,
        updatedAt: Math.max(now(), (latest?.updatedAt ?? 0) + 1),
      }
      delete v.agent
      s.user = [...s.user, v]
      s.selection = { key, seen: compute(s).versions.length }
      notify(s)
      if (serverOn(s)) {
        backend!.put(s.sid!, key, putBody(v, true)).then(
          () => {
            v.persisted = true
          },
          (err: unknown) => console.debug('[aiui artifacts] could not store the restored version', err),
        )
      }
      return compute(s).versions.find((a) => a.key === key && a.edited && a.updatedAt === v.updatedAt) ?? null
    },
    async ensure(sid) {
      await threads.load?.(sid)
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
