/**
 * Dev-only harness for the legacy host (see legacy-dev.html). It stands in for
 * the React shell: a page picker, a mode toggle and a full-height content
 * region rendering <LegacyViewHost key={id}>, under StrictMode.
 *
 * Probes drive it through window.__legacyHarness.
 */
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { LegacyViewHost } from '../src/legacy/LegacyViewHost'
import { ensureLegacyRuntime, setLegacyNavigator } from '../src/legacy/runtime'
import type { ShellPage } from '../src/sdk/manifest'
import standInTokens from './legacy-dev-tokens.css?inline'

const params = new URLSearchParams(location.search)

// Stand-in for styles/theme.css until the design-system package lands: only
// when the real token layer is absent (no --seed-paper on <html>).
if (params.get('tokens') !== 'off') {
  const hasTokenLayer = getComputedStyle(document.documentElement).getPropertyValue('--seed-paper').trim() !== ''
  if (!hasTokenLayer) {
    const style = document.createElement('style')
    style.id = 'legacy-dev-standin-tokens'
    style.textContent = standInTokens
    document.head.appendChild(style)
  }
}

// set_custom_css, injected the way server.py does it (with the css guard).
const customCss = params.get('customCss')
if (customCss) {
  const style = document.createElement('style')
  style.id = 'aiui-custom-css'
  style.textContent = customCss
  document.head.appendChild(style)
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLStyleElement && node.id !== 'aiui-custom-css') document.head.appendChild(style)
      }
    }
  }).observe(document.head, { childList: true })
}

function currentId(): string {
  return new URLSearchParams(location.search).get('page') || ''
}

const listeners = new Set<() => void>()
function navigate(id: string) {
  if (currentId() === id) return
  const next = new URLSearchParams(location.search)
  next.set('page', id)
  history.pushState({ pageId: id }, '', `${location.pathname}?${next}`)
  listeners.forEach((fn) => fn())
}
setLegacyNavigator(navigate)

interface LegacyHarnessApi {
  navigate: (id: string) => void
  pages: () => ShellPage[]
}
const harnessWindow = window as Window & { __legacyHarness?: LegacyHarnessApi }

function toShellPage(raw: Record<string, unknown>): ShellPage {
  return {
    id: String(raw.id),
    title: typeof raw.title === 'string' ? raw.title : String(raw.id),
    kind: 'legacy',
    icon: typeof raw.icon === 'string' ? raw.icon : undefined,
    group: typeof raw.group === 'string' ? raw.group : undefined,
    order: typeof raw.order === 'number' ? raw.order : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    apiEndpoint: typeof raw.api_endpoint === 'string' ? raw.api_endpoint : null,
    layout: typeof raw.layout === 'string' ? raw.layout : undefined,
  }
}

// eslint-disable-next-line react-refresh/only-export-components -- harness entry, not an HMR boundary
function Harness() {
  const [pageId, setPageId] = useState(currentId)
  const [pages, setPages] = useState<ShellPage[]>([])
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))

  useEffect(() => {
    const sync = () => setPageId(currentId())
    listeners.add(sync)
    window.addEventListener('popstate', sync)
    return () => {
      listeners.delete(sync)
      window.removeEventListener('popstate', sync)
    }
  }, [])

  useEffect(() => {
    let live = true
    ensureLegacyRuntime()
      .then((rt) => {
        if (!live) return
        const list = (rt.pages as Record<string, unknown>[]).map(toShellPage)
        setPages(list)
        if (!currentId() && list[0]) navigate(list[0].id)
      })
      .catch((err) => console.error('[legacy-dev] runtime failed', err))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    harnessWindow.__legacyHarness = { navigate, pages: () => pages }
  }, [pages])

  const toggleMode = () => {
    const next = !dark
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('aiui-theme-preference', next ? 'dark' : 'light')
    } catch {
      /* private mode */
    }
    setDark(next)
  }

  const page = pages.find((p) => p.id === pageId)
  return (
    <div className="aiui-app" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header
        style={{
          height: 48,
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--background)',
          color: 'var(--foreground)',
          fontSize: 14,
        }}
      >
        <strong>Legacy host harness</strong>
        <select
          aria-label="Page"
          value={pageId}
          onChange={(e) => navigate(e.target.value)}
          style={{ font: 'inherit', color: 'inherit', background: 'transparent', minWidth: 0, maxWidth: '45vw' }}
        >
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.group ? `${p.group} / ` : ''}
              {p.title} ({p.id})
            </option>
          ))}
        </select>
        <button type="button" onClick={toggleMode} style={{ marginLeft: 'auto', font: 'inherit' }}>
          {dark ? 'Light' : 'Dark'} mode
        </button>
      </header>
      <main
        id="harness-content"
        style={{
          flex: '1 1 0%',
          minHeight: 0,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
          padding: '24px 32px',
          background: 'var(--background)',
          color: 'var(--foreground)',
        }}
      >
        {pageId ? <LegacyViewHost key={pageId} pageId={pageId} page={page} /> : null}
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
