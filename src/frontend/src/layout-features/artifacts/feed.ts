/**
 * The artifacts feature's entry for a layout (chunk `lf-artifacts`): the one
 * store the canvas, the cards, the page and the `artifacts` layout feed
 * share, wired to the chat store and to the server when `builtin.artifacts`
 * is on. A layout descriptor provides the feed lazily, so none of this
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

// The chat store is imported, not bundled in: the chat page has it in memory
// already (the canvas and cards render inside it), and the artifacts page
// gets it on first use, so this feature's chunk does not carry it.
type ChatThreads = typeof import('@/chat-engine/store').threadStore
let chat: ChatThreads | null = null
let chatLoading: Promise<ChatThreads> | null = null
const NO_THREAD: ThreadView = Object.freeze({ messages: Object.freeze([]) as readonly never[], isRunning: false })

function loadChat(): Promise<ChatThreads> {
  chatLoading ??= import('@/chat-engine/store').then(
    (m) => (chat = m.threadStore),
    (err: unknown) => {
      chatLoading = null
      throw err
    },
  )
  return chatLoading
}

const threads: ThreadSource = {
  get: (sid) => chat?.get(sid) ?? NO_THREAD,
  subscribe(sid, fn) {
    if (chat) return chat.subscribe(sid, fn)
    let off: (() => void) | null = null
    let live = true
    loadChat().then(
      (t) => {
        if (!live) return
        off = t.subscribe(sid, fn)
        fn()
      },
      (err: unknown) => console.warn('[aiui artifacts] the chat store did not load', err),
    )
    return () => {
      live = false
      off?.()
    }
  },
  load: async (sid) => (await loadChat()).load(sid),
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
