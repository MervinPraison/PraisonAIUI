/**
 * Keyboard shortcuts for layout frames: `mod+n`, `mod+1`, `shift+?`, `alt+c`.
 * `mod` is ⌘ on Apple platforms and Ctrl elsewhere. A shortcut never fires
 * while the viewer types (inputs, editors, terminals) unless asked to, and
 * never when another handler already took the key.
 */
import { useEffect, useRef } from 'react'

export interface Shortcut {
  key: string
  mod: boolean
  shift: boolean
  alt: boolean
}

/** `mod+shift+k` → { key: 'k', mod, shift }. Keys compare case-insensitively. */
export function parseShortcut(combo: string): Shortcut {
  const parts = combo.toLowerCase().split('+').map((p) => p.trim())
  const key = parts.pop() || ''
  return { key, mod: parts.includes('mod'), shift: parts.includes('shift'), alt: parts.includes('alt') }
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent || '')
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>

export function matchesShortcut(e: KeyLike, combo: string | Shortcut, mac = isMacPlatform()): boolean {
  const s = typeof combo === 'string' ? parseShortcut(combo) : combo
  if (e.key.toLowerCase() !== s.key) return false
  const mod = mac ? e.metaKey : e.ctrlKey
  const other = mac ? e.ctrlKey : e.metaKey
  if (mod !== s.mod || other || e.altKey !== s.alt) return false
  // `?` and other shifted symbols already carry the shift in e.key
  return s.shift ? e.shiftKey : !e.shiftKey || !/^[a-z0-9]$/.test(s.key)
}

const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], .monaco-editor, .xterm, .cm-editor, [data-aiui-own-keys]'

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as (Element & { isContentEditable?: boolean }) | null
  if (!el || typeof el.closest !== 'function') return false
  return !!el.isContentEditable || el.closest(TYPING) !== null
}

export interface ShortcutOptions {
  /** Also fire while focus is in a text field (for `mod+…` combos). Default false. */
  allowInInputs?: boolean
}

/** Run `handler` on `combo` (null: off). The latest handler is used; one listener per hook. */
export function useShortcut(combo: string | null, handler: (e: KeyboardEvent) => void, opts: ShortcutOptions = {}): void {
  const latest = useRef(handler)
  useEffect(() => {
    latest.current = handler
  })
  const allowInInputs = opts.allowInInputs === true
  useEffect(() => {
    if (!combo) return
    const shortcut = parseShortcut(combo)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || !matchesShortcut(e, shortcut)) return
      if (!allowInInputs && isTypingTarget(e.target)) return
      e.preventDefault()
      latest.current(e)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [combo, allowInInputs])
}

/** Keycap labels for a combo: `mod+shift+k` → ['⌘', '⇧', 'K'] (or ['Ctrl', 'Shift', 'K']). */
export function shortcutLabels(combo: string, mac = isMacPlatform()): string[] {
  const s = parseShortcut(combo)
  const out: string[] = []
  if (s.mod) out.push(mac ? '⌘' : 'Ctrl')
  if (s.alt) out.push(mac ? '⌥' : 'Alt')
  if (s.shift) out.push(mac ? '⇧' : 'Shift')
  out.push(s.key.length === 1 ? s.key.toUpperCase() : s.key[0].toUpperCase() + s.key.slice(1))
  return out
}
