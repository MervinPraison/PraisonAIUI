import './index.css'

// Boot entry (assets/index.js). It stays tiny: it only decides which UI to
// load, and both choices are lazy chunks.
//   <html data-aiui-shell="react">  (style: app)  -> shell/mount
//   anything else (chat, docs, agents, playground, custom) -> legacy-app-entry
// The vanilla `dashboard` style never loads this script at all.

// A deploy replaces the hashed chunks. A tab still running the previous
// index.js then fails to fetch a lazy chunk; reload once to pick up the new
// build. The guard is keyed by this entry's URL (it carries ?v=<build>), so a
// chunk that is missing in the *current* build cannot cause a reload loop.
const RELOAD_KEY = 'aiuiReloadedFor'
window.addEventListener('vite:preloadError', (event) => {
  const build = import.meta.url
  try {
    if (sessionStorage.getItem(RELOAD_KEY) === build) return
    sessionStorage.setItem(RELOAD_KEY, build)
  } catch {
    return // no sessionStorage: never risk an unguarded reload loop
  }
  event.preventDefault()
  window.location.reload()
})

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

// When the preloadError handler above has scheduled a reload, Vite resolves
// the import with `undefined` instead of rejecting, hence the `m &&` guards.
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
