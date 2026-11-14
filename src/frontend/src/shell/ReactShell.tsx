/**
 * The app shell (ADR-0001 §3): the root element, the skip link, the command
 * palette, the settings dialog, global shortcuts and the document title.
 * The frame around the routed page is the selected layout's (ADR 0003,
 * shell/LayoutHost.tsx) or the core's classic frame (shell/ClassicFrame.tsx).
 * The shell never touches the legacy runtime's DOM; legacy views live inside
 * LegacyViewHost's own mount node.
 */
import { lazy, Suspense, useEffect, useMemo } from 'react'
import { getPage, useRegistryVersion } from '@/sdk/registry'
import type { ShellManifest, ShellPage } from '@/sdk/manifest'
import { useShell } from './context'
import { ClassicFrame } from './ClassicFrame'
import { LayoutHost } from './LayoutHost'
import { MAIN_ID, navPagesForLayout, resolveRoutePage } from './layoutNav'
import { useActiveLayout } from './layoutSelect'
import { defaultPageId, isFullBleed, orderedPages, showPageHeader, siteTitle } from './nav'
import {
  installPaletteHooks,
  isPaletteShortcut,
  setCommandPaletteOpen,
  toggleCommandPalette,
  useCommandPaletteOpen,
  useCommandPaletteRequested,
} from './palette'
import { navigate, PAGE_CHANGE_EVENT, usePageId } from './router'
import { useNavGroupsConfig } from './useNavGroups'
import { setSettingsDialogOpen, useSettingsDialog } from './settingsForm'
import { useApplyThemePresets } from './themePresets'

const CommandPalette = lazy(() => import('./CommandPalette'))
const SettingsDialog = lazy(() => import('./SettingsDialog'))

export default function ReactShell() {
  const { manifest, pluginsSettled } = useShell()
  const pageId = usePageId()
  // Late registerPage() calls (plugins) can turn an unknown id into a page.
  useRegistryVersion()
  const active = useActiveLayout(manifest, pluginsSettled)
  // The layout on screen ('' while the classic frame is: none selected, or the fallback).
  const layoutId = active.render === 'layout' ? active.selected : ''
  const pages = manifest.pages
  // Layout-owned pages of other layouts leave the sidebar and palette (their URLs still render).
  const listedPages = useMemo(() => navPagesForLayout(pages, layoutId), [pages, layoutId])
  const frameManifest = useMemo<ShellManifest>(
    () => (listedPages.length === pages.length && listedPages.every((p, i) => p === pages[i]) ? manifest : { ...manifest, pages: listedPages }),
    [manifest, pages, listedPages],
  )
  const groups = useNavGroupsConfig(manifest)
  const firstPage = useMemo(() => orderedPages(listedPages, groups)[0], [listedPages, groups])
  const header = showPageHeader(manifest)
  const title = siteTitle(manifest)

  const paletteOpen = useCommandPaletteOpen()
  const paletteRequested = useCommandPaletteRequested()
  const settings = useSettingsDialog()
  useApplyThemePresets()

  const page: ShellPage | undefined = resolveRoutePage(pages, pageId, layoutId)
  const pageTitle = page?.title ?? (pageId ? (getPage(pageId) ? pageId : 'Not found') : title)
  const fullBleed = isFullBleed(page)
  const home = active.spec?.home

  // `/` → the configured default page, else the layout's home, else the first
  // page (replace: Back must not bounce). Waits while the layout is pending.
  useEffect(() => {
    if (pageId || active.render === 'pending') return
    const target = defaultPageId(manifest, groups, layoutId ? home : undefined)
    if (target) navigate(target, { replace: true })
  }, [pageId, manifest, groups, layoutId, home, active.render])

  useEffect(() => {
    document.title = pageId && pageTitle !== title ? `${pageTitle} · ${title}` : title
  }, [pageId, pageTitle, title])

  // Global shortcut: Ctrl/Cmd+K palette (Ctrl/Cmd+B belongs to the classic frame).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isPaletteShortcut(e)) {
        e.preventDefault()
        toggleCommandPalette()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // dashboard.js assigns window.aiui.openCommandPalette when it loads; reclaim it.
  useEffect(() => {
    installPaletteHooks()
    window.addEventListener(PAGE_CHANGE_EVENT, installPaletteHooks)
    return () => window.removeEventListener(PAGE_CHANGE_EVENT, installPaletteHooks)
  }, [])

  const classic = (
    <ClassicFrame
      manifest={frameManifest}
      pageId={page?.id ?? pageId}
      page={page}
      pageTitle={pageTitle}
      fullBleed={fullBleed}
      firstPage={firstPage}
      pluginsSettled={pluginsSettled}
    />
  )

  return (
    <div
      className="aiui-app flex h-dvh w-full overflow-hidden bg-background text-foreground"
      data-aiui-shell-root=""
      data-aiui-page-header={header ? 'shown' : 'hidden'}
      data-aiui-layout={layoutId || undefined}
    >
      <a
        href={`#${MAIN_ID}`}
        className="sr-only z-[var(--z-blocking,1000)] rounded-lg bg-background px-3 py-2 text-sm font-medium text-foreground shadow-lg ring-2 ring-ring focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <LayoutHost
        active={active}
        manifest={manifest}
        groups={groups}
        routeId={pageId}
        page={page}
        fullBleed={fullBleed}
        firstPage={firstPage}
        pluginsSettled={pluginsSettled}
        classic={classic}
      />
      {settings.requested && (
        <Suspense fallback={null}>
          <SettingsDialog open={settings.open} onOpenChange={setSettingsDialogOpen} initialSectionId={settings.sectionId} />
        </Suspense>
      )}
      {paletteRequested && (
        <Suspense fallback={null}>
          <CommandPalette
            open={paletteOpen}
            onOpenChange={setCommandPaletteOpen}
            pages={listedPages}
            groups={groups}
            activeId={pageId}
          />
        </Suspense>
      )}
    </div>
  )
}
