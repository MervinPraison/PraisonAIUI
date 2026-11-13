/**
 * Legacy dashboard runtime loader (strangler host, ADR-0001 §2.3).
 *
 * Imports /plugins/dashboard.js once as an ES module. The Python server serves
 * it; Vite never bundles it. Then it boots the module's host mode
 * (initHostRuntime: scoped styles, auth fetch, onboarding, approval events,
 * dashboard-plugin manifests) and hands out mountView(). In this mode
 * dashboard.js never builds its own shell or touches #root.
 *
 * Contract (ADR-0001 §5):
 *   ensureLegacyRuntime(): Promise<{ pages; mountView(id, el, {page, signal}) }>
 *   preloadLegacyRuntime(): void
 *   setLegacyNavigator(fn: (id: string) => void): void
 */
import type { ShellPage } from '../sdk/manifest'
// The --db-* token bridge. It is loaded with the runtime (not only with a
// LegacyViewHost) so overlays the runtime appends to <body> (onboarding,
// session search) are themed before any legacy page mounts.
import './bridge.css'

export interface LegacyMountOptions {
  page?: ShellPage
  signal?: AbortSignal
}

export interface LegacyRuntime {
  /** /api/pages plus pages contributed by dashboard-plugins. */
  pages: unknown[]
  /** Mount a legacy view into `el`; resolves to its cleanup. */
  mountView(pageId: string, el: HTMLElement, opts: LegacyMountOptions): Promise<() => void>
}

/** Options dashboard.js initHostRuntime() understands. */
interface HostRuntimeOptions {
  navigate: (pageId: string) => unknown
  /** false: the shell owns Ctrl+K and window.aiui.openCommandPalette. */
  palette: boolean
  /** 'event-only': announce approvals on window, never open the legacy modal. */
  approvalUi: 'modal' | 'event-only'
}

interface LegacyModule {
  initHostRuntime(opts: HostRuntimeOptions): Promise<{ pages: unknown[] }>
  mountView(pageId: string, el: HTMLElement, opts: LegacyMountOptions): Promise<() => void>
}

type RegisterView = ((pageId: string, render: unknown, cleanup?: unknown) => void) & {
  __aiuiHostWrapped?: true
}

interface LegacyWindowApi {
  selectPage?: (pageId: string) => unknown
  registerView?: RegisterView
  [key: string]: unknown
}

// A local view of window.aiui (no global Window augmentation, so other modules
// can type the parts of window.aiui they own without conflicting).
const legacyWindow = (): Window & { aiui?: LegacyWindowApi } => window

/** Resolve a legacy selectPage() promise at the latest this long after navigating. */
const SELECT_PAGE_TIMEOUT_MS = 5000

let runtimePromise: Promise<LegacyRuntime> | null = null
let currentPageId: string | null = null
let pageTrackerInstalled = false

function firstSegment(pathname: string): string {
  return pathname.replace(/^\/+/, '').split('/')[0] || ''
}

/** Until the shell installs its router, navigate with a plain pushState. */
let navigateImpl: (pageId: string) => void = (pageId) => {
  if (firstSegment(window.location.pathname) !== pageId) {
    window.history.pushState({ pageId }, '', `/${pageId}`)
  }
}

/** The shell installs its router here; legacy selectPage() calls go through it. */
export function setLegacyNavigator(fn: (pageId: string) => void): void {
  navigateImpl = fn
}

function trackPageChanges() {
  if (pageTrackerInstalled) return
  pageTrackerInstalled = true
  window.addEventListener('aiui:page-change', (e) => {
    const id = (e as CustomEvent<{ pageId?: unknown }>).detail?.pageId
    currentPageId = typeof id === 'string' ? id : null
  })
}

/**
 * Legacy `selectPage(id)` in host mode. It routes through the shell and
 * resolves once that page has mounted (aiui:page-change for the id), or after
 * SELECT_PAGE_TIMEOUT_MS. Views await it before talking to the new page, e.g.
 * code-studio: `selectPage('chat').then(() => dispatch aiui:prefill-composer)`.
 */
function isShowing(pageId: string): boolean {
  if (currentPageId !== pageId) return false
  if (firstSegment(window.location.pathname) === pageId) return true
  // Hosts that do not route by path (dev harness): a ready legacy host counts.
  return [...document.querySelectorAll<HTMLElement>('.aiui-legacy-host[data-status="ready"]')].some(
    (el) => el.dataset.legacyPage === pageId,
  )
}

function hostSelectPage(pageId: string): Promise<void> {
  return new Promise<void>((resolve) => {
    if (isShowing(pageId)) {
      // Already on it: navigating is a no-op and no page-change follows.
      resolve()
      return
    }
    let timer = 0
    const finish = () => {
      window.clearTimeout(timer)
      window.removeEventListener('aiui:page-change', onChange)
      resolve()
    }
    const onChange = (e: Event) => {
      if ((e as CustomEvent<{ pageId?: unknown }>).detail?.pageId === pageId) finish()
    }
    window.addEventListener('aiui:page-change', onChange)
    timer = window.setTimeout(finish, SELECT_PAGE_TIMEOUT_MS)
    try {
      navigateImpl(pageId)
    } catch (err) {
      console.warn(`[legacy] navigate('${pageId}') failed`, err)
      finish()
    }
  })
}

/**
 * Point window.aiui at the host. Re-applied after every import (by identity,
 * not a one-time flag) so a re-evaluated dashboard.js can never leave its raw
 * selectPage on window.
 */
function installCompatShims() {
  const w = legacyWindow()
  const api = (w.aiui = w.aiui || {})
  api.selectPage = hostSelectPage

  // A late registerView() (a dashboard-plugin or /custom.js) for the page on
  // screen: dashboard.js only re-renders while it owns its own shell, so tell
  // LegacyViewHost to re-mount.
  const original = api.registerView
  if (typeof original === 'function' && !original.__aiuiHostWrapped) {
    const wrapped: RegisterView = (pageId, render, cleanup) => {
      original(pageId, render, cleanup)
      window.dispatchEvent(new CustomEvent('aiui:view-registered', { detail: { pageId } }))
    }
    wrapped.__aiuiHostWrapped = true
    api.registerView = wrapped
  }
}

/**
 * Number of failed `import()` calls of dashboard.js so far. Browsers cache a
 * failed module fetch under its URL for the life of the document (Chromium's
 * module map does), so importing the same URL again rejects at once without a
 * request. Each retry therefore adds `r=<n>` to get a fresh fetch.
 */
let failedImports = 0
/** The settled import of dashboard.js. Kept after success so the module is only evaluated once. */
let modulePromise: Promise<LegacyModule> | null = null

function legacyModuleUrl(): string {
  // The build id busts the browser's heuristic cache after an upgrade. Nothing
  // else imports dashboard.js in this mode, so it is still one module instance.
  const build = window.__AIUI_BUILD__
  const params: string[] = []
  if (build) params.push(`v=${encodeURIComponent(String(build))}`)
  // Only after a failed import: a new URL after a successful one would load a
  // second dashboard.js instance (two runtimes, two sets of window hooks).
  if (failedImports > 0) params.push(`r=${failedImports}`)
  return params.length ? `/plugins/dashboard.js?${params.join('&')}` : '/plugins/dashboard.js'
}

/**
 * Import dashboard.js once. A rejected import (network error, 5xx, a module
 * that throws while evaluating) is forgotten and the next call fetches a new
 * URL; a successful one is reused for the rest of the page's life.
 */
function importLegacyModule(): Promise<LegacyModule> {
  if (!modulePromise) {
    const attempt = import(/* @vite-ignore */ legacyModuleUrl()) as Promise<LegacyModule>
    modulePromise = attempt
    attempt.catch(() => {
      if (modulePromise !== attempt) return
      failedImports += 1
      modulePromise = null
    })
  }
  return modulePromise
}

/**
 * Import and boot the legacy runtime once. A failed attempt is retried on the
 * next call (LegacyViewHost's Retry, the next legacy page): a failed import
 * with a fresh URL, a failed boot on the module already loaded.
 */
export function ensureLegacyRuntime(): Promise<LegacyRuntime> {
  if (!runtimePromise) {
    const attempt = (async (): Promise<LegacyRuntime> => {
      trackPageChanges()
      const mod = await importLegacyModule()
      if (typeof mod.initHostRuntime !== 'function' || typeof mod.mountView !== 'function') {
        throw new Error('/plugins/dashboard.js has no host runtime (initHostRuntime/mountView)')
      }
      installCompatShims()
      const { pages } = await mod.initHostRuntime({
        navigate: hostSelectPage,
        palette: false,
        approvalUi: 'event-only',
      })
      return { pages: Array.isArray(pages) ? pages : [], mountView: mod.mountView }
    })()
    runtimePromise = attempt
    attempt.catch((err) => {
      console.warn('[legacy] runtime failed to load', err)
      if (runtimePromise === attempt) runtimePromise = null
    })
  }
  return runtimePromise
}

/** Warm the runtime when the browser is idle (ahead of the first legacy page). */
export function preloadLegacyRuntime(): void {
  if (runtimePromise || typeof window === 'undefined') return
  const start = () => {
    ensureLegacyRuntime().catch(() => {
      /* logged in ensureLegacyRuntime; a later mount retries */
    })
  }
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(start, { timeout: 2000 })
  } else {
    window.setTimeout(start, 200)
  }
}
