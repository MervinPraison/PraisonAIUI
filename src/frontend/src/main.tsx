import './index.css'
import { createChunkErrorHandler } from './chunkReload'

// Boot entry (assets/index.js). It stays tiny: it only decides which UI to
// load, and both choices are lazy chunks.
//   <html data-aiui-shell="react">  (style: app)  -> shell/mount
//   anything else (chat, docs, agents, playground, custom) -> legacy-app-entry
// The vanilla `dashboard` style never loads this script at all.

// A failed lazy chunk: reload once only when the server now serves another
// build (a deploy), never because the network is down (chunkReload.ts). The
// error itself reaches the page's error boundary, whose Try again retries.
function sessionStore(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}
window.addEventListener(
  'vite:preloadError',
  createChunkErrorHandler({
    entryUrl: import.meta.url,
    isOnline: () => navigator.onLine !== false,
    fetchPage: () =>
      fetch(window.location.pathname, { cache: 'no-store', credentials: 'same-origin' }).then((r) =>
        r.ok ? r.text() : '',
      ),
    onOnline: (cb) => window.addEventListener('online', cb, { once: true }),
    storage: sessionStore(),
    reload: () => window.location.reload(),
  }),
)

const rootEl = document.getElementById('root')

function bootFailed(err: unknown) {
  console.error('[aiui] failed to load the UI bundle', err)
  if (rootEl && !rootEl.hasChildNodes()) {
    const msg = document.createElement('div')
    msg.setAttribute('role', 'alert')
    msg.style.cssText = 'padding:24px;font:14px system-ui,sans-serif'
    msg.textContent = 'The interface failed to load. Reload the page to try again.'
    rootEl.appendChild(msg)
  }
}

// The preloadError handler never calls preventDefault, so a failed import
// rejects into bootFailed. (Vite resolves a prevented one with `undefined`;
// the `m &&` guards keep that case harmless.)
if (rootEl) {
  if (document.documentElement.dataset.aiuiShell === 'react') {
    import('./shell/mount')
      .then((m) => m && m.mountShell(rootEl))
      .catch(bootFailed)
  } else {
    import('./legacy-app-entry')
      .then((m) => m && m.mountApp(rootEl))
      .catch(bootFailed)
  }
}
