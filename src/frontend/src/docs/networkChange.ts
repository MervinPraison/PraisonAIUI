/**
 * Hear when the network may have changed under a request: the browser came
 * back online (`online`: a new network, or the old one again) or the tab woke
 * up (`visibilitychange` to visible, e.g. after the laptop slept).
 *
 * Why: every tab of a profile shares one HTTP/2 connection per origin. When
 * that connection dies silently (sleep, Wi-Fi switch), requests on it wait
 * until the browser notices, which JavaScript cannot speed up (its ping and
 * idle timeouts are the browser's own). The browser does drop its pooled
 * connections when the network changes, so a request started *after* such a
 * change goes out on a fresh connection. docLoader.ts uses this to end a
 * waiting attempt at that moment and send a new one, instead of waiting out
 * the attempt's time limit on the dead connection.
 */

export interface NetworkEnv {
    win: Pick<Window, 'addEventListener' | 'removeEventListener'>
    doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
}

const browserEnv = (): NetworkEnv | null =>
    typeof window === 'undefined' || typeof document === 'undefined' ? null : { win: window, doc: document }

/** Calls `onChange` on `online` and when the tab becomes visible again. Returns the remover. */
export function onNetworkChange(onChange: () => void, env: NetworkEnv | null = browserEnv()): () => void {
    if (!env) return () => {}
    const onVisible = () => { if (env.doc.visibilityState === 'visible') onChange() }
    env.win.addEventListener('online', onChange)
    env.doc.addEventListener('visibilitychange', onVisible)
    return () => {
        env.win.removeEventListener('online', onChange)
        env.doc.removeEventListener('visibilitychange', onVisible)
    }
}
