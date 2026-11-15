/**
 * The artifacts feature's entry for a layout (chunk `lf-artifacts`): the one
 * store the canvas, the cards, the page and the `artifacts` layout feed
 * share, wired to the `chat` layout feed and to the server when
 * `builtin.artifacts` is on. A layout descriptor provides the feed lazily, so none of this
 * loads before a frame or region needs it:
 *
 *   provideLayoutData('artifacts', () =>
 *     import('@/layout-features/artifacts/feed').then((m) => m.createArtifactsFeed({ minLines })))
 *
 *   chat: { aside: () => import('@/layout-features/artifacts/CanvasPanel'),
 *           turnFooter: () => import('@/layout-features/artifacts/ArtifactCards') }
 *   registerPage('artifacts', () => import('@/layout-features/artifacts/ArtifactsPage'))
 */
import type { Artifact, ArtifactsFeed, Feed } from '@/sdk/layoutTypes'
import { getLayoutData, loadLayoutData } from '@/sdk/layouts'
import { artifactsServerEnabled, fetchSessionArtifacts, putArtifact } from './api'
import type { DeriveOptions } from './derive'
import { createArtifactsStore, type ArtifactsStore, type SessionArtifacts, type ThreadSource, type ThreadView } from './store'

let store: ArtifactsStore | null = null
let options: DeriveOptions = {}

/** Thresholds for what counts as an artifact (`layout.options.<layout>.minLines` / `minRows`). */
export function configureArtifacts(opts: DeriveOptions): void {
  const next = { ...options, ...opts }
  if (store && (next.minLines !== options.minLines || next.minRows !== options.minRows)) store = null
  options = next
}

// The chat comes through the `chat` layout feed (builtin.chat provides it),
// not from chat-engine internals: the feature reads the same frozen contract
// as any frame, and its chunk neither carries the chat store nor splits it
// out of the chat route. The feed is the open session's; other sessions'
// artifacts come from the server (./store), so the artifacts page works
// without loading those chats.
const NO_THREAD: ThreadView = Object.freeze({ messages: Object.freeze([]) as readonly never[], isRunning: false })

const threads: ThreadSource = {
  get(sid) {
    const state = getLayoutData('chat')?.get()
    return state && state.sessionId === sid ? state : NO_THREAD
  },
  subscribe(_sid, fn) {
    let off: (() => void) | null = null
    let live = true
    void loadLayoutData('chat').then((feed) => {
      if (!live || !feed) return
      off = feed.subscribe(fn)
      fn()
    })
    return () => {
      live = false
      off?.()
    }
  },
}

/** The shared store (created on first use). */
export function artifactsStore(): ArtifactsStore {
  store ??= createArtifactsStore({
    threads,
    backend: {
      enabled: () => artifactsServerEnabled(),
      fetchSession: fetchSessionArtifacts,
      put: putArtifact,
    },
    derive: options,
  })
  return store
}

/**
 * The `artifacts` layout feed: per session, the latest version of every
 * artifact (first-appearance order); `open` shows one in the canvas.
 */
export function createArtifactsFeed(opts: DeriveOptions = {}): ArtifactsFeed {
  configureArtifacts(opts)
  const feeds = new Map<string, Feed<readonly Artifact[]>>()
  return {
    forSession(sid) {
      const k = sid ?? ''
      let f = feeds.get(k)
      if (!f) {
        const session = () => artifactsStore().session(sid)
        let cache: { snap: SessionArtifacts; out: readonly Artifact[] } | null = null
        f = {
          get() {
            const snap = session().get()
            if (cache?.snap.latest !== snap.latest) cache = { snap, out: snap.latest }
            return cache.out
          },
          subscribe: (fn) => session().subscribe(fn),
        }
        feeds.set(k, f)
      }
      return f
    },
    open: (sid, key, version) => artifactsStore().open(sid, key, version),
  }
}

export default createArtifactsFeed
