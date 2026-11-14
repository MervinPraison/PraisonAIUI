/**
 * Plugin theme presets (registerThemePreset, a plugin's themes()): the
 * viewer's choice, and the CSS that applies it. A preset only sets L0 seed
 * tokens; theme.css derives every other colour from them.
 *
 * The choice is a per-viewer convenience in localStorage; an unknown or
 * removed preset means the app's own theme.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { useThemePresets, type ThemePreset } from '@/sdk/contributions'

export const THEME_PRESET_KEY = 'aiui-theme-preset'
export const THEME_PRESET_ATTR = 'data-aiui-preset'
const STYLE_ID = 'aiui-plugin-themes'

function declarations(tokens: Readonly<Record<string, string>>): string {
  return Object.entries(tokens)
    .map(([k, v]) => `${k}: ${v};`)
    .join(' ')
}

/**
 * One rule per preset and mode. Unlayered, and more specific than the
 * server's seed tag (`:root`), so the chosen preset wins; light tokens are
 * scoped to `:not(.dark)` so they never leak into dark mode. Ids and tokens
 * were validated by registerThemePreset.
 */
export function presetCss(presets: readonly ThemePreset[]): string {
  const rules: string[] = []
  for (const p of presets) {
    const sel = `html[${THEME_PRESET_ATTR}="${p.id}"]`
    if (Object.keys(p.light).length) rules.push(`${sel}:not(.dark) { ${declarations(p.light)} }`)
    if (Object.keys(p.dark).length) rules.push(`${sel}.dark { ${declarations(p.dark)} }`)
  }
  return rules.join('\n')
}

function readStored(): string | null {
  try {
    return globalThis.localStorage?.getItem(THEME_PRESET_KEY) || null
  } catch {
    return null
  }
}

let selected: string | null | undefined
const listeners = new Set<() => void>()

function getSelected(): string | null {
  if (selected === undefined) selected = readStored()
  return selected
}

/** Pick a preset by id, or null for the app's own theme. */
export function setThemePreset(id: string | null): void {
  selected = id
  try {
    if (id) globalThis.localStorage?.setItem(THEME_PRESET_KEY, id)
    else globalThis.localStorage?.removeItem(THEME_PRESET_KEY)
  } catch {
    /* per-viewer convenience only */
  }
  for (const fn of [...listeners]) fn()
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

const noPreset = () => null

/** The chosen preset id (it may name a preset that is not registered). */
export function useThemePresetChoice(): string | null {
  return useSyncExternalStore(subscribe, getSelected, noPreset)
}

/** Keep the presets' CSS and `<html data-aiui-preset>` in step with the registry and the choice. */
export function useApplyThemePresets(): void {
  const presets = useThemePresets()
  const choice = useThemePresetChoice()
  useEffect(() => {
    if (presets.length === 0) return
    const el = document.createElement('style')
    el.id = STYLE_ID
    el.textContent = presetCss(presets)
    document.head.appendChild(el)
    return () => el.remove()
  }, [presets])
  const active = choice !== null && presets.some((p) => p.id === choice) ? choice : null
  useEffect(() => {
    const root = document.documentElement
    if (active) root.setAttribute(THEME_PRESET_ATTR, active)
    else root.removeAttribute(THEME_PRESET_ATTR)
  }, [active])
}
