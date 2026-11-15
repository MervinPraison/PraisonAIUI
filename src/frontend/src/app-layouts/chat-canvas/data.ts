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

/**
 * Artifacts across every chat (`GET /api/artifacts`, builtin.artifacts), for
 * the nav count. `enabled` is false when the nav has no artifacts page (the
 * record is off); `refreshKey` changes when a run ends. Undefined until known
 * or when the server has no index.
 */
export function useArtifactTotal(enabled: boolean, refreshKey: string): number | undefined {
  const [total, setTotal] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (!enabled) return
    const ctl = new AbortController()
    fetchJson<{ count?: unknown }>('/api/artifacts?limit=1', { signal: ctl.signal })
      .then((r) => setTotal(typeof r?.count === 'number' && r.count >= 0 ? r.count : undefined))
      .catch(() => {
        // aborted, or no index on this server: no count
      })
    return () => ctl.abort()
  }, [enabled, refreshKey])
  return enabled ? total : undefined
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
 * feature is not in the build. `load` is for tests.
 */
export function useProvideArtifacts(load: (() => Promise<unknown>) | undefined = FEED_LOADER): void {
  useEffect(() => {
    if (!load) return
    return provideLayoutData('artifacts', () => load().then(toArtifactsFeed))
  }, [load])
}
