/**
 * Command palette state and global hooks. The palette UI (cmdk + dialog) is a
 * lazy chunk; this module only holds the open flag, so it stays tiny.
 *
 * The shell owns Ctrl/Cmd+K and window.aiui.openCommandPalette. The legacy
 * runtime is told not to install its own palette (initHostRuntime
 * {palette:false}, WP4); because dashboard.js assigns
 * window.aiui.openCommandPalette when it evaluates, the shell re-installs its
 * hooks on every aiui:page-change as well.
 */
import { useSyncExternalStore } from 'react'
import { PAGE_CHANGE_EVENT } from './router'

let open = false
let requested = false
const listeners = new Set<() => void>()

function emit() {
  for (const fn of [...listeners]) fn()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function setCommandPaletteOpen(next: boolean): void {
  if (next) requested = true
  if (open === next) return
  open = next
  emit()
}

export function openCommandPalette(): void {
  setCommandPaletteOpen(true)
}

export function closeCommandPalette(): void {
  setCommandPaletteOpen(false)
}

export function toggleCommandPalette(): void {
  setCommandPaletteOpen(!open)
}

const getOpen = () => open
const getRequested = () => requested

export function useCommandPaletteOpen(): boolean {
  return useSyncExternalStore(subscribe, getOpen, getOpen)
}

/** True once the palette was opened at least once (its chunk is then mounted). */
export function useCommandPaletteRequested(): boolean {
  return useSyncExternalStore(subscribe, getRequested, getRequested)
}

/** Warm the palette chunk (idle time, or hover/focus on the search button). */
export function preloadCommandPalette(): void {
  void import('./CommandPalette').catch(() => {
    /* retried on open */
  })
}

/**
 * Run `fn` once the first page is on screen (its chunk loaded and mounted),
 * or after `timeoutMs` if no page announces itself, so warm-up downloads
 * (the palette) never compete with the routed page's own chunks. `fn` may
 * return a cleanup (e.g. an idle-callback cancel). Returns a canceller.
 */
export function afterFirstPage(fn: () => void | (() => void), timeoutMs = 8000): () => void {
  let done = false
  let inner: void | (() => void)
  const run = () => {
    if (done) return
    done = true
    window.removeEventListener(PAGE_CHANGE_EVENT, run)
    window.clearTimeout(timer)
    inner = fn()
  }
  window.addEventListener(PAGE_CHANGE_EVENT, run)
  const timer = window.setTimeout(run, timeoutMs)
  return () => {
    if (!done) {
      done = true
      window.removeEventListener(PAGE_CHANGE_EVENT, run)
      window.clearTimeout(timer)
    }
    if (typeof inner === 'function') inner()
  }
}

type AiuiWindow = Window & { aiui?: Record<string, unknown> }

/** Point window.aiui.openCommandPalette / closeCommandPalette at the shell palette. */
export function installPaletteHooks(): void {
  const w = window as AiuiWindow
  const aiui = (w.aiui = w.aiui || {})
  if (aiui.openCommandPalette !== openCommandPalette) aiui.openCommandPalette = openCommandPalette
  if (aiui.closeCommandPalette !== closeCommandPalette) aiui.closeCommandPalette = closeCommandPalette
}

/** Editors and terminals keep their own Ctrl+K (Monaco uses it as a chord prefix). */
const OWN_KEYS_SELECTOR = '.monaco-editor, .xterm, .cm-editor, [data-aiui-own-keys]'

function targetElement(e: KeyboardEvent): Element | null {
  const t = e.target
  return t && typeof (t as Element).closest === 'function' ? (t as Element) : null
}

export function isEditableTarget(e: KeyboardEvent): boolean {
  const el = targetElement(e)
  if (!el) return false
  if ((el as HTMLElement).isContentEditable) return true
  return el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null
}

/**
 * Ctrl/Cmd+K (without Shift/Alt), unless an editor/terminal owns the key.
 *
 * Inside the open palette the shortcut always counts (it closes the palette):
 * cmdk's vim bindings call preventDefault() on Ctrl+K to move the selection up,
 * which would otherwise make Ctrl+K a one-way switch on Windows and Linux.
 */
export function isPaletteShortcut(e: KeyboardEvent): boolean {
  if (e.isComposing) return false
  if (e.key !== 'k' && e.key !== 'K') return false
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return false
  const el = targetElement(e)
  if (el?.closest('[cmdk-root]')) return true
  if (e.defaultPrevented) return false
  return el?.closest(OWN_KEYS_SELECTOR) == null
}

/** Ctrl/Cmd+B toggles the sidebar, except while typing. */
export function isSidebarShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing) return false
  if (e.key !== 'b' && e.key !== 'B') return false
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return false
  if (isEditableTarget(e)) return false
  return targetElement(e)?.closest(OWN_KEYS_SELECTOR) == null
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

/** Label for the palette shortcut: ⌘K on Apple platforms, Ctrl K elsewhere. */
export function paletteShortcutLabel(): string {
  return isMacPlatform() ? '⌘K' : 'Ctrl K'
}
