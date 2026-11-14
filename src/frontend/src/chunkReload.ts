/**
 * What to do when a lazy chunk fails to load (Vite's `vite:preloadError`).
 *
 * A deploy replaces the hashed chunks, and a tab still running the previous
 * index.js then cannot fetch a lazy chunk: reloading once picks up the new
 * build. But a chunk also fails when the network is simply down, and
 * reloading then lands on the browser's offline page and loses the draft and
 * any live stream. So the error is never swallowed (it reaches the page's
 * error boundary, whose Try again retries the import), and the page reloads
 * only after the server's current HTML shows a different build than the one
 * running. Offline, nothing reloads; the check runs again once back online.
 *
 * At most one reload per running build (sessionStorage), so a chunk that is
 * missing in the current build can never cause a reload loop.
 */
export const RELOAD_KEY = 'aiuiReloadedFor'

/** The `?v=` build id of `/assets/index.js` in a URL or an HTML document, or null. */
export function entryBuild(text: string): string | null {
  const m = /\/assets\/index\.js\?v=([A-Za-z0-9._-]+)/.exec(text)
  return m ? m[1] : null
}

export interface ChunkReloadDeps {
  /** URL of the running entry (import.meta.url: `/assets/index.js?v=<build>`). */
  entryUrl: string
  isOnline(): boolean
  /** The server's HTML for the current page, fetched without the cache. */
  fetchPage(): Promise<string>
  onOnline(cb: () => void): void
  storage: Pick<Storage, 'getItem' | 'setItem'> | null
  reload(): void
}

/**
 * Returns the `vite:preloadError` handler. It never calls preventDefault, and
 * one check runs at a time. Resolves (for tests) once the check is done.
 */
export function createChunkErrorHandler(deps: ChunkReloadDeps): () => Promise<void> {
  const running = entryBuild(deps.entryUrl)
  let checking: Promise<void> | null = null
  let waitingForOnline = false

  const alreadyReloaded = () => {
    try {
      return deps.storage?.getItem(RELOAD_KEY) === deps.entryUrl
    } catch {
      return true // no storage: never risk an unguarded reload loop
    }
  }

  const check = async (): Promise<void> => {
    if (!running || !deps.storage || alreadyReloaded()) return
    if (!deps.isOnline()) {
      if (!waitingForOnline) {
        waitingForOnline = true
        deps.onOnline(() => {
          waitingForOnline = false
          void handle()
        })
      }
      return
    }
    let html: string
    try {
      html = await deps.fetchPage()
    } catch {
      return // still unreachable: the page's Try again is the way back
    }
    const served = entryBuild(html)
    if (!served || served === running) return // same build: a transient failure, not a deploy
    try {
      deps.storage.setItem(RELOAD_KEY, deps.entryUrl)
    } catch {
      return
    }
    deps.reload()
  }

  const handle = () => {
    checking ??= check().finally(() => {
      checking = null
    })
    return checking
  }
  return handle
}
