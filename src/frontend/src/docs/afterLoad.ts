/**
 * Run optional work after the page's `load` event, when the browser is idle.
 *
 * `load` waits for every request in flight when it would fire: a prefetch or
 * a lazy import started while the page is still loading makes `load` (and
 * anything a tracker or the browser waits on it for) late, and a stuck one
 * makes it very late. So prefetches of other pages, the GitHub star count and
 * the opt-in telemetry chunk start here, never during the load. Work the page
 * needs to render (its own Markdown, the renderer) does not wait.
 */

export interface LoadEnv {
    doc: Pick<Document, 'readyState'>
    win: Pick<Window, 'addEventListener' | 'removeEventListener'> & Partial<Pick<Window, 'requestIdleCallback' | 'cancelIdleCallback'>>
}

const browserEnv = (): LoadEnv | null =>
    typeof window === 'undefined' || typeof document === 'undefined' ? null : { doc: document, win: window }

/** Run `fn` when the browser is idle (or after a short delay without requestIdleCallback). Returns a canceller. */
export function whenIdle(fn: () => void, win: LoadEnv['win'] | undefined = browserEnv()?.win): () => void {
    if (typeof win?.requestIdleCallback === 'function') {
        const id = win.requestIdleCallback(fn, { timeout: 3_000 })
        return () => win.cancelIdleCallback?.(id)
    }
    const id = setTimeout(fn, 300)
    return () => clearTimeout(id)
}

/** Run `fn` once the page has loaded (at once if it has), then at idle. Returns a canceller. */
export function afterLoad(fn: () => void, env: LoadEnv | null = browserEnv()): () => void {
    if (!env) return () => {}
    let cancel = () => {}
    let done = false
    const start = () => {
        if (!done) cancel = whenIdle(fn, env.win)
    }
    if (env.doc.readyState === 'complete') {
        start()
        return () => { done = true; cancel() }
    }
    env.win.addEventListener('load', start, { once: true })
    return () => {
        done = true
        env.win.removeEventListener('load', start)
        cancel()
    }
}
