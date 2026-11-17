/**
 * What the Chat and Canvas frame reads: the chat, artifacts and sessions
 * feeds (useLayoutData; each may be off, so every hook has an empty value),
 * the cross-session artifact count for the nav, and the artifacts feed
 * itself, which this layout provides while it is on screen.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { provideLayoutData, useLayoutData } from '@/sdk/layouts'
import type { Artifact, ArtifactsFeed, ChatState, Feed } from '@/sdk/layoutTypes'
import { fetchJson } from '@/sdk/services'

const noSubscribe = () => () => {}

/** A feed's value (useSyncExternalStore), or `empty` while there is no feed. */
export function useFeed<S>(feed: Feed<S> | null | undefined, empty: S): S {
  const read = feed ? feed.get : () => empty
  return useSyncExternalStore(feed ? feed.subscribe : noSubscribe, read, read)
}

const NO_ARTIFACTS: readonly Artifact[] = Object.freeze([])

/** The artifacts of a session (every version), [] without the artifacts feed. */
export function useSessionArtifacts(sessionId: string | null): readonly Artifact[] {
  const artifacts = useLayoutData('artifacts')
  const feed = useMemo(() => (artifacts ? artifacts.forSession(sessionId) : null), [artifacts, sessionId])
  return useFeed(feed, NO_ARTIFACTS)
}

/** The open chat, or null without the chat feed. */
export function useChat(): ChatState | null {
  const chat = useLayoutData('chat')
  return useFeed<ChatState | null>(chat, null)
}

export interface ArtifactIndex {
  /** Artifacts across every chat (the Artifacts row's count); undefined until known. */
  total?: number
  /** Artifacts per chat (the chat rows' "3 artifacts"). */
  bySession: ReadonlyMap<string, number>
}

const NO_INDEX: ArtifactIndex = { bySession: new Map() }

/** The server index's rows (no content) as counts. */
export function countIndex(body: { count?: unknown; artifacts?: unknown } | null | undefined): ArtifactIndex {
  const bySession = new Map<string, number>()
  for (const a of Array.isArray(body?.artifacts) ? body.artifacts : []) {
    const sid = (a as { sessionId?: unknown })?.sessionId
    if (typeof sid === 'string' && sid) bySession.set(sid, (bySession.get(sid) ?? 0) + 1)
  }
  return { total: typeof body?.count === 'number' && body.count >= 0 ? body.count : undefined, bySession }
}

/** The open chat's live count (its artifacts before the server has them) over the index. */
export function withLiveCount(index: ArtifactIndex, live: { sessionId: string; count: number } | null): ArtifactIndex {
  if (!live) return index
  const before = index.bySession.get(live.sessionId) ?? 0
  if (before === live.count) return index
  const bySession = new Map(index.bySession).set(live.sessionId, live.count)
  return { total: index.total === undefined ? undefined : Math.max(0, index.total - before + live.count), bySession }
}

/**
 * The artifacts index (`GET /api/artifacts`, builtin.artifacts): the nav's
 * total and each chat's count. `enabled` is false when the nav has no
 * artifacts page (the record is off); `refreshKey` changes when a run ends.
 */
export function useArtifactIndex(enabled: boolean, refreshKey: string): ArtifactIndex {
  const [index, setIndex] = useState<ArtifactIndex>(NO_INDEX)
  useEffect(() => {
    if (!enabled) return
    const ctl = new AbortController()
    fetchJson<{ count?: unknown; artifacts?: unknown }>('/api/artifacts?limit=1000', { signal: ctl.signal })
      .then((r) => setIndex(countIndex(r)))
      .catch(() => {
        // aborted, or no index on this server: no counts
      })
    return () => ctl.abort()
  }, [enabled, refreshKey])
  return enabled ? index : NO_INDEX
}

// ── the artifacts feed ───────────────────────────────────────────────

/** Path of the artifacts feature's feed module (track A), as the glob keys it. */
export const ARTIFACTS_FEED = '/src/layout-features/artifacts/feed.ts'

const isFeed = (v: unknown): v is ArtifactsFeed =>
  typeof v === 'object' && v !== null && typeof (v as ArtifactsFeed).forSession === 'function' && typeof (v as ArtifactsFeed).open === 'function'

/**
 * The ArtifactsFeed a feed module exports: `artifactsFeed`, or the default
 * export as the feed or a function returning it. Throws when it has none
 * (the SDK logs the failed load once and the frame shows no counts).
 */
export function toArtifactsFeed(mod: unknown): ArtifactsFeed {
  const m = (mod ?? {}) as Record<string, unknown>
  for (const c of [m.artifactsFeed, m.default]) {
    const v = typeof c === 'function' ? (c as () => unknown)() : c
    if (isFeed(v)) return v
  }
  throw new TypeError('the artifacts feed module exports no ArtifactsFeed (artifactsFeed or default)')
}

function feedModule(): (() => Promise<unknown>) | undefined {
  try {
    return import.meta.glob('/src/layout-features/artifacts/feed.ts')[ARTIFACTS_FEED]
  } catch {
    return undefined // outside Vite (unit tests): the glob is not transformed
  }
}

const FEED_LOADER = feedModule()

/**
 * Provide the `artifacts` feed while this frame is mounted, lazily (the
 * feature chunk loads the first time a region reads it). Nothing when the
 * feature is not in the build or `load` is null (a layout without a canvas).
 * `undefined` uses the build's feed module; a function is for tests.
 */
export function useProvideArtifacts(load: (() => Promise<unknown>) | null | undefined = FEED_LOADER): void {
  useEffect(() => {
    if (!load) return
    return provideLayoutData('artifacts', () => load().then(toArtifactsFeed))
  }, [load])
}
