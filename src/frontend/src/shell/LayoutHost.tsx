/**
 * Layout host (ADR 0003 §1.2): renders the selected layout's frame around
 * the routed page, or the classic frame.
 *
 *   selection   shell/layoutSelect.ts (tab preview from ?layout=, the
 *               viewer's stored choice, the server default), re-run when
 *               setLayout() switches live
 *   frame       the registered layout component (lazy: its chunk loads only
 *               now), inside Suspense (a frame skeleton) and an error
 *               boundary that falls back to the classic frame with one toast
 *               and an `aiui:plugin-error` event (R4)
 *   props       LayoutProps: the Outlet (PageView), the nav model
 *               (shell/layoutNav.ts), chrome, viewport, the layout switcher
 *
 *   tokens      a layout frame paints with the PraisonAI Pro tokens
 *               (styles/pro.css and its Geist faces, styles/fonts.css,
 *               imported here so they ship in the shell chunk, never in
 *               index.css): setTokenSystem('pro') while a
 *               frame is mounted, setTokenSystem(null) for the classic frame
 *               and the fallback
 *   look        the frame's meta.look (Chat + Canvas: "paper") as
 *               <html data-aiui-look> while it is mounted, unless the viewer
 *               chose plain Pro (proTokens setLookChoice, the "Switch look: …"
 *               commands of builtin.layouts); the
 *               looks' CSS (styles/paper.css) ships here beside pro.css, so a
 *               look paints before the frame's chunk arrives
 *
 * The host names no layout: ids come from the manifest and the registry.
 */
import {
  Component,
  createContext,
  Suspense,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { useTheme } from 'next-themes'
import {
  activateLayout,
  useLayout,
  LAYOUT_BREAKPOINTS,
  layoutViewport,
  setLayout,
  type LayoutChrome,
  type LayoutComponent,
  type LayoutProps,
  type LayoutViewport,
} from '@/sdk/layouts'
import type { ShellManifest, ShellPage } from '@/sdk/manifest'
import { notify } from '@/sdk/notify'
import '@/styles/pro.css'
import '@/styles/fonts.css'
import '@/styles/paper.css'
import { getLookChoice, setTokenSystem, subscribeLookChoice } from '@/proTokens'
import { buildLayoutNav, MAIN_ID } from './layoutNav'
import type { ActiveLayout } from './layoutSelect'
import { siteLogo, siteTitle, type NavGroupsConfig } from './nav'
import { openCommandPalette } from './palette'
import { PageView } from './PageView'
import { PageSkeleton } from './primitives'
import { navigate } from './router'
import { Slot } from './Slot'

// ── viewport ─────────────────────────────────────────────────────────

const VIEWPORT_QUERIES = [
  `(max-width: ${LAYOUT_BREAKPOINTS.phone - 0.02}px)`,
  `(max-width: ${LAYOUT_BREAKPOINTS.tablet - 0.02}px)`,
]

function subscribeViewport(fn: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const lists = VIEWPORT_QUERIES.map((q) => window.matchMedia(q))
  for (const l of lists) l.addEventListener('change', fn)
  return () => {
    for (const l of lists) l.removeEventListener('change', fn)
  }
}

const readViewport = (): LayoutViewport => layoutViewport(window.innerWidth)
const serverViewport = (): LayoutViewport => 'desktop'

function useViewport(): LayoutViewport {
  const viewport = useSyncExternalStore(subscribeViewport, readViewport, serverViewport)
  // The window's resize event reaches the page while the old frame is still
  // drawn (a desktop sidebar beside a phone-width column): content that
  // measures itself on that event, like the composer's auto-height, measured
  // a sliver. Once the frame for the new viewport is drawn, ask again.
  const seen = useRef(viewport)
  useEffect(() => {
    if (seen.current === viewport) return
    seen.current = viewport
    const id = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    return () => cancelAnimationFrame(id)
  }, [viewport])
  return viewport
}

// ── outlet and slots (stable components; the routed page comes from context) ──

interface OutletState {
  /** The URL's page id. */
  routeId: string
  /** The page rendered for it (a replacement under some layouts). */
  pageId: string
  page: ShellPage | undefined
  pluginsSettled: boolean
  fullBleed: boolean
  firstPage?: ShellPage
}

const OutletContext = createContext<OutletState | null>(null)

function useOutletState(): OutletState {
  const state = useContext(OutletContext)
  if (!state) throw new Error('Outlet and chrome.Slot render only inside a layout frame')
  return state
}

/** The routed page: error boundary, page toolbar slot and Suspense (PageView). */
function Outlet({ className }: { className?: string }) {
  const o = useOutletState()
  return (
    <PageView
      key={o.pageId}
      pageId={o.pageId}
      page={o.page}
      pluginsSettled={o.pluginsSettled}
      fullBleed={o.fullBleed}
      firstPage={o.firstPage}
      className={className}
    />
  )
}

function FrameSlot({ name, className }: { name: string; className?: string }) {
  const o = useOutletState()
  return <Slot name={name} pageId={o.routeId} page={o.page} className={className} />
}

/** Suspense fallback while a frame chunk loads (no bare "Loading…"). */
export function FrameSkeleton() {
  return (
    <div data-aiui-skeleton="frame" className="flex min-w-0 flex-1 flex-col p-4 md:p-8">
      <PageSkeleton />
    </div>
  )
}

// ── token system ─────────────────────────────────────────────────────

/** Pro tokens while a layout frame is mounted (the server may already have set them for first paint). */
function useProTokens(layoutLook: string | undefined): void {
  useLayoutEffect(() => {
    setTokenSystem('pro')
    return () => setTokenSystem(null)
  }, [])
  const choice = useSyncExternalStore(subscribeLookChoice, getLookChoice, getLookChoice)
  const look = choice === 'pro' ? undefined : layoutLook
  useLayoutEffect(() => {
    if (!look) return
    const root = document.documentElement
    root.setAttribute('data-aiui-look', look)
    return () => root.removeAttribute('data-aiui-look')
  }, [look])
}

/** The classic frame paints with the classic tokens, whatever the server guessed for first paint. */
function ClassicTokens({ children }: { children: ReactNode }) {
  useLayoutEffect(() => setTokenSystem(null), [])
  return <>{children}</>
}

// ── error boundary ───────────────────────────────────────────────────

interface BoundaryProps {
  id: string
  title: string
  source: string
  fallback: ReactNode
  children: ReactNode
}

function pluginName(source: string): string {
  const i = source.indexOf(':')
  return i >= 0 ? source.slice(i + 1) || source : source || 'layout'
}

/** A frame that fails to load or render: the classic frame, one toast, `aiui:plugin-error`. */
class LayoutBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const { id, title, source } = this.props
    const message = error instanceof Error ? error.message || error.name : String(error)
    console.error(`[aiui shell] layout '${id}' failed; showing the classic frame`, error, info.componentStack)
    activateLayout('')
    void notify(`The “${title}” layout failed to load`, {
      type: 'error',
      description: message,
      id: `aiui-layout:${id}`,
    })
    window.dispatchEvent(
      new CustomEvent('aiui:plugin-error', {
        detail: { url: '', source, plugin: pluginName(source), message, error, layout: id },
      }),
    )
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

// ── the host ─────────────────────────────────────────────────────────

export interface LayoutHostProps {
  active: ActiveLayout
  manifest: ShellManifest
  groups: NavGroupsConfig
  /** The URL's page id. */
  routeId: string
  /** The page rendered for it. */
  page: ShellPage | undefined
  fullBleed: boolean
  firstPage?: ShellPage
  pluginsSettled: boolean
  /** The classic frame: shown for '' and as the fallback. */
  classic: ReactNode
}

function LayoutFrame({ active, manifest, groups, routeId, page, fullBleed, Frame }: LayoutHostProps & { Frame: LayoutComponent }) {
  useProTokens(useLayout()?.meta.look)
  const viewport = useViewport()
  const { resolvedTheme, setTheme } = useTheme()
  const spec = useMemo(
    () => active.spec ?? { id: active.selected, title: active.selected, source: 'builtin' },
    [active.spec, active.selected],
  )
  const available = useMemo(() => manifest.layouts?.available ?? [], [manifest.layouts])

  const nav = useMemo(
    () => buildLayoutNav({ pages: manifest.pages, groups, spec, activeId: routeId, go: (id) => navigate(id) }),
    [manifest.pages, groups, spec, routeId],
  )
  const chrome = useMemo<LayoutChrome>(
    () => ({
      siteTitle: siteTitle(manifest),
      siteLogo: siteLogo(manifest),
      openPalette: (opts) => openCommandPalette(opts),
      toggleColorMode: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
      Slot: FrameSlot,
      mainId: MAIN_ID,
    }),
    [manifest, resolvedTheme, setTheme],
  )
  const layout = useMemo(
    () => ({ id: active.selected, available, switchTo: (id: string) => setLayout(id) }),
    [active.selected, available],
  )
  const props: LayoutProps = {
    Outlet,
    pageId: routeId,
    page,
    fullBleed,
    nav,
    chrome,
    viewport,
    layout,
  }
  return <Frame {...props} />
}

export function LayoutHost(props: LayoutHostProps) {
  const { active, classic, routeId, page, pluginsSettled, fullBleed, firstPage } = props
  const outlet = useMemo<OutletState>(
    () => ({ routeId, pageId: page?.id ?? routeId, page, pluginsSettled, fullBleed, firstPage }),
    [routeId, page, pluginsSettled, fullBleed, firstPage],
  )
  if (active.render === 'classic' || !active.component) {
    return active.render === 'pending' ? <FrameSkeleton /> : <ClassicTokens>{classic}</ClassicTokens>
  }
  const spec = active.spec
  return (
    <LayoutBoundary
      key={active.selected}
      id={active.selected}
      title={spec?.title ?? active.selected}
      source={spec?.source ?? ''}
      fallback={<ClassicTokens>{classic}</ClassicTokens>}
    >
      <Suspense fallback={<FrameSkeleton />}>
        <OutletContext.Provider value={outlet}>
          <LayoutFrame {...props} Frame={active.component} />
        </OutletContext.Provider>
      </Suspense>
    </LayoutBoundary>
  )
}
