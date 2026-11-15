/**
 * Which layout the shell renders (ADR 0003 §1.2): pure functions (storage
 * is read through sdk/layouts, so layoutSelect.test.ts runs them under plain
 * node) and the useActiveLayout() hook the shell renders with.
 *
 *   L = manifest.layouts                    absent or empty → classic ('')
 *   candidates = [ tab preview (seeded once from ?layout=),
 *                  the viewer's stored choice (only when L.userChoice),
 *                  L.default ]
 *   active = the first candidate that is '' (classic) or offered; else ''
 *
 * The shell never names a layout: ids come from the manifest only.
 */
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import {
  activateLayout,
  getLayoutComponent,
  LAYOUT_PREVIEW_KEY,
  parseLayoutChoice,
  provideLayoutHost,
  readStoredLayout,
  subscribeLayouts,
  type LayoutComponent,
} from '@/sdk/layouts'
import { registerManifestLayouts } from '@/sdk/loadPlugins'
import { CLASSIC_LAYOUT_ID, type ShellLayouts, type ShellLayoutSpec, type ShellManifest } from '@/sdk/manifest'

/** What selectLayout() reads besides the manifest: '' = classic, null = nothing stored. */
export interface StoredLayout {
  preview: string | null
  choice: string | null
}

/** The layouts a server offers (none for an older server). */
export function availableLayouts(layouts: ShellLayouts | undefined): readonly ShellLayoutSpec[] {
  return layouts?.available ?? []
}

/** The id to render: a layout `layouts` offers, or '' for the classic frame. */
export function selectLayout(layouts: ShellLayouts | undefined, stored: StoredLayout): string {
  const available = availableLayouts(layouts)
  if (!layouts || available.length === 0) return ''
  const ids = new Set(available.map((s) => s.id))
  const candidates = [stored.preview, layouts.userChoice ? stored.choice : null, layouts.default]
  for (const c of candidates) {
    if (c === null || c === undefined) continue
    if (c === '' || ids.has(c)) return c
  }
  return ''
}

/** The manifest entry of `id`, if the server offers it. */
export function layoutSpec(layouts: ShellLayouts | undefined, id: string): ShellLayoutSpec | undefined {
  return id ? availableLayouts(layouts).find((s) => s.id === id) : undefined
}

/**
 * The `?layout=` value of a query string ('' = classic), or null when absent
 * or not a layout id.
 */
export function layoutFromQuery(search: string): string | null {
  if (!search) return null
  let value: string | null
  try {
    value = new URLSearchParams(search).get('layout')
  } catch {
    return null
  }
  return value === null ? null : parseLayoutChoice(value)
}

let seeded = false

/**
 * Copy `?layout=` into the tab's preview (sessionStorage) once per page load,
 * before the first navigate() drops the query string. A later reload of the
 * same tab keeps the preview; it never touches the stored choice.
 */
export function seedLayoutPreview(
  search: string = typeof window === 'undefined' ? '' : window.location.search,
  storage: Pick<Storage, 'setItem'> | null = sessionStorageOrNull(),
): void {
  if (seeded) return
  seeded = true
  const id = layoutFromQuery(search)
  if (id === null) return
  try {
    storage?.setItem(LAYOUT_PREVIEW_KEY, id || CLASSIC_LAYOUT_ID)
  } catch {
    // blocked storage: no preview (the stored choice or the default applies)
  }
}

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

/** Test hook: let seedLayoutPreview() run again. */
export function resetLayoutSeedForTests(): void {
  seeded = false
}

/**
 * What the host shows for the selected id:
 *   'classic'  the classic frame (nothing selected, or the layout never registered)
 *   'layout'   the registered frame
 *   'pending'  a skeleton: plugins may still register the layout
 */
export type LayoutRender = 'classic' | 'layout' | 'pending'

export function layoutRender(selected: string, registered: boolean, pluginsSettled: boolean): LayoutRender {
  if (!selected) return 'classic'
  if (registered) return 'layout'
  return pluginsSettled ? 'classic' : 'pending'
}

// ── selection ────────────────────────────────────────────────────────

const selectionListeners = new Set<() => void>()
let hostInstalled = false

function subscribeSelection(fn: () => void): () => void {
  selectionListeners.add(fn)
  return () => {
    selectionListeners.delete(fn)
  }
}

/** setLayout() stored the switch: re-run the selection (an unknown id falls back). */
function installLayoutHost(): void {
  if (hostInstalled) return
  hostInstalled = true
  provideLayoutHost({
    select: () => {
      for (const fn of [...selectionListeners]) fn()
    },
  })
}

export interface ActiveLayout {
  /** The selected id ('' = classic), registered or not. */
  selected: string
  /** What the host shows for it. */
  render: LayoutRender
  /** The selected layout's manifest entry. */
  spec?: ShellLayoutSpec
  component?: LayoutComponent
}

const warnedMissing = new Set<string>()

/**
 * The layout to render for `manifest`. Seeds the `?layout=` preview and
 * registers the manifest's plugin layouts (lazily) before the first read, so
 * neither the first redirect nor a deep link loses them.
 */
export function useActiveLayout(manifest: ShellManifest, pluginsSettled: boolean): ActiveLayout {
  const [firstManifest] = useState(() => {
    seedLayoutPreview()
    installLayoutHost()
    registerManifestLayouts(manifest)
    return manifest
  })
  useEffect(() => {
    if (manifest !== firstManifest) registerManifestLayouts(manifest)
  }, [manifest, firstManifest])

  const read = () => selectLayout(manifest.layouts, readStoredLayout())
  const selected = useSyncExternalStore(subscribeSelection, read, read)
  const readComponent = () => (selected ? getLayoutComponent(selected) : undefined)
  const component = useSyncExternalStore(subscribeLayouts, readComponent, readComponent)
  const render = layoutRender(selected, component !== undefined, pluginsSettled)

  // Report what is on screen to useLayout() before paint, so a page that
  // reads the presentation never shows the classic one first.
  useLayoutEffect(() => {
    activateLayout(render === 'layout' ? selected : '')
  }, [render, selected])

  useEffect(() => {
    if (!selected || render !== 'classic' || warnedMissing.has(selected)) return
    warnedMissing.add(selected)
    console.warn(`[aiui shell] layout '${selected}' is offered but nothing registered it; showing the classic frame`)
  }, [selected, render])

  return { selected, render, spec: layoutSpec(manifest.layouts, selected), component }
}
