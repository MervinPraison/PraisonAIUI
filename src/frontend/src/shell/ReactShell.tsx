/**
 * The app shell: sidebar + header + routed page body (ADR-0001 §3).
 * The shell never touches the legacy runtime's DOM; legacy views live inside
 * LegacyViewHost's own mount node.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { getPage, useRegistryVersion } from '@/sdk/registry'
import type { ShellPage } from '@/sdk/manifest'
import { cn } from '@/lib/utils'
import { useShell } from './context'
import { FloatingMenuButton, ShellHeader } from './Header'
import { defaultPageId, isFullBleed, navGroups, orderedPages, showPageHeader, showSidebar, siteTitle } from './nav'
import {
  installPaletteHooks,
  isPaletteShortcut,
  isSidebarShortcut,
  setCommandPaletteOpen,
  toggleCommandPalette,
  useCommandPaletteOpen,
  useCommandPaletteRequested,
} from './palette'
import { PageView } from './PageView'
import { navigate, PAGE_CHANGE_EVENT, usePageId } from './router'
import { AppSidebar } from './Sidebar'

const CommandPalette = lazy(() => import('./CommandPalette'))
const loadMobileNav = () => import('./MobileNav')
const MobileNav = lazy(loadMobileNav)

/** Same key as the legacy dashboard sidebar, so the choice carries over. */
const COLLAPSED_KEY = 'aiui-sidebar-collapsed'

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === 'true'
  } catch {
    return false
  }
}

function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c
      try {
        window.localStorage.setItem(COLLAPSED_KEY, String(next))
      } catch {
        /* not persisted */
      }
      return next
    })
  }, [])
  return [collapsed, toggle]
}

function preloadMobileNav() {
  void loadMobileNav().catch(() => {
    /* retried on open */
  })
}

export default function ReactShell() {
  const { manifest, pluginsSettled } = useShell()
  const pageId = usePageId()
  // Late registerPage() calls (plugins) can turn an unknown id into a page.
  useRegistryVersion()
  const pages = manifest.pages
  const pageById = useMemo(() => new Map(pages.map((p) => [p.id, p] as const)), [pages])
  const groups = useMemo(() => navGroups(manifest), [manifest])
  const firstPage = useMemo(() => orderedPages(pages, groups)[0], [pages, groups])
  const sidebar = showSidebar(manifest)
  const header = showPageHeader(manifest)
  const title = siteTitle(manifest)

  const [collapsed, toggleCollapsed] = useSidebarCollapsed()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mobileRequested, setMobileRequested] = useState(false)
  const paletteOpen = useCommandPaletteOpen()
  const paletteRequested = useCommandPaletteRequested()

  const openMobileNav = useCallback(() => {
    setMobileRequested(true)
    setMobileOpen(true)
  }, [])

  const page: ShellPage | undefined = pageById.get(pageId)
  const pageTitle = page?.title ?? (pageId ? (getPage(pageId) ? pageId : 'Not found') : title)
  const fullBleed = isFullBleed(page)

  // `/` → the configured default page, else the first page (replace: Back must not bounce).
  useEffect(() => {
    if (pageId) return
    const target = defaultPageId(manifest)
    if (target) navigate(target, { replace: true })
  }, [pageId, manifest])

  useEffect(() => {
    document.title = pageId && pageTitle !== title ? `${pageTitle} · ${title}` : title
  }, [pageId, pageTitle, title])

  // Global shortcuts: Ctrl/Cmd+K palette, Ctrl/Cmd+B sidebar.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isPaletteShortcut(e)) {
        e.preventDefault()
        toggleCommandPalette()
      } else if (sidebar && isSidebarShortcut(e)) {
        e.preventDefault()
        toggleCollapsed()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sidebar, toggleCollapsed])

  // dashboard.js assigns window.aiui.openCommandPalette when it loads; reclaim it.
  useEffect(() => {
    installPaletteHooks()
    window.addEventListener(PAGE_CHANGE_EVENT, installPaletteHooks)
    return () => window.removeEventListener(PAGE_CHANGE_EVENT, installPaletteHooks)
  }, [])

  return (
    <div
      className="aiui-app flex h-dvh w-full overflow-hidden bg-background text-foreground"
      data-aiui-shell-root=""
      data-aiui-page-header={header ? 'shown' : 'hidden'}
    >
      <a
        href="#aiui-main"
        className="sr-only z-[var(--z-blocking,1000)] rounded-lg bg-background px-3 py-2 text-sm font-medium text-foreground shadow-lg ring-2 ring-ring focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      {sidebar && (
        <AppSidebar
          manifest={manifest}
          activeId={pageId}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          className="hidden md:flex"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {header ? (
          <ShellHeader
            title={pageTitle}
            description={page?.description}
            pageId={pageId}
            page={page}
            showMenuButton={sidebar}
            onOpenMenu={openMobileNav}
            onPreloadMenu={preloadMobileNav}
          />
        ) : (
          sidebar && <FloatingMenuButton onOpenMenu={openMobileNav} onPreloadMenu={preloadMobileNav} />
        )}
        <main
          id="aiui-main"
          tabIndex={-1}
          className={cn(
            'aiui-app min-h-0 min-w-0 flex-1 outline-none',
            fullBleed ? 'flex flex-col overflow-hidden' : 'overflow-y-auto',
          )}
        >
          <PageView
            key={pageId}
            pageId={pageId}
            page={page}
            pluginsSettled={pluginsSettled}
            fullBleed={fullBleed}
            firstPage={firstPage}
          />
        </main>
      </div>
      {sidebar && mobileRequested && (
        <Suspense fallback={null}>
          <MobileNav open={mobileOpen} onOpenChange={setMobileOpen} manifest={manifest} activeId={pageId} />
        </Suspense>
      )}
      {paletteRequested && (
        <Suspense fallback={null}>
          <CommandPalette
            open={paletteOpen}
            onOpenChange={setCommandPaletteOpen}
            pages={pages}
            groups={groups}
            activeId={pageId}
          />
        </Suspense>
      )}
    </div>
  )
}
