/**
 * The core's own frame: sidebar + header + routed page body (ADR-0001 §3).
 * It is what the app shell shows when no layout is selected, and the
 * fallback when a selected layout is not registered or crashes (ADR 0003).
 * It has no layout id.
 *
 * Moved out of ReactShell unchanged: ReactShell keeps the root element, the
 * skip link, the palette and settings dialogs and the global Ctrl/Cmd+K, so
 * the DOM of the classic shell is exactly what it was.
 */
import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { ShellManifest, ShellPage } from '@/sdk/manifest'
import { cn } from '@/lib/utils'
import { FloatingMenuButton, ShellHeader } from './Header'
import { showPageHeader, showSidebar } from './nav'
import { isSidebarShortcut } from './palette'
import { PageView } from './PageView'
import { AppSidebar } from './Sidebar'

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

export interface ClassicFrameProps {
  /** The manifest, with the pages this frame lists (layout-owned pages of other layouts left out). */
  manifest: ShellManifest
  pageId: string
  page: ShellPage | undefined
  pageTitle: string
  fullBleed: boolean
  firstPage?: ShellPage
  pluginsSettled: boolean
}

export function ClassicFrame({ manifest, pageId, page, pageTitle, fullBleed, firstPage, pluginsSettled }: ClassicFrameProps) {
  const sidebar = showSidebar(manifest)
  const header = showPageHeader(manifest)
  const [collapsed, toggleCollapsed] = useSidebarCollapsed()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mobileRequested, setMobileRequested] = useState(false)

  const openMobileNav = useCallback(() => {
    setMobileRequested(true)
    setMobileOpen(true)
  }, [])

  // Ctrl/Cmd+B toggles the sidebar (Ctrl/Cmd+K stays with ReactShell).
  useEffect(() => {
    if (!sidebar) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (isSidebarShortcut(e)) {
        e.preventDefault()
        toggleCollapsed()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sidebar, toggleCollapsed])

  return (
    <>
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
    </>
  )
}
