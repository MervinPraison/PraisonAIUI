/**
 * builtin.layouts: the built-in layouts (ADR 0003) and the layout picker.
 *
 *   - registers each built-in layout the manifest offers (`layouts.available`
 *     with a built-in source) through sdk.registerLayout(id, meta, loader):
 *     the frame chunk loads only when that layout is rendered;
 *   - "Switch layout: …" palette commands (group "Layout") for every offered
 *     layout, plugin layouts included, and the classic frame;
 *   - Settings → Appearance: a select of the same, saved in this browser
 *     (`localStorage['aiui-layout']`), when the server allows a user choice;
 *   - "Switch look: <Look>" / "Switch look: Pro" when an offered layout has
 *     a look of its own (meta.look, Chat + Canvas's Paper), saved in this
 *     browser (`localStorage['aiui-look']`, proTokens setLookChoice);
 *   - the four Pro accents (Pro Indigo, Blue, Teal, Graphite) as theme
 *     presets, when the shell has theme presets: they set only the
 *     `--seed-pro-*` seeds, so they recolour layouts and never the classic
 *     frame.
 *
 * A layout's Python record (`builtin.layout-<id>`) decides whether it is
 * offered; switching one off with `extensions.disabled` removes it from the
 * manifest, so it is neither registered nor listed here.
 */
import { LayoutTemplate } from 'lucide-react'
import { LAYOUT_STORAGE_KEY, parseLayoutChoice } from '@/sdk/layouts'
import { CLASSIC_LAYOUT_ID, type ShellLayoutSpec, type ShellLayouts } from '@/sdk/manifest'
import { proThemePresets, setLookChoice } from '@/proTokens'
import type { BuiltinPlugin, BuiltinSdk } from '../types'
import { chatLayout } from './chat'
import { chatCanvasLayout } from './chat-canvas'
import { commandLayout } from './command'
import { guidedLayout } from './guided'
import { missionLayout } from './mission'
import type { LayoutDescriptor } from './types'
import { workbenchLayout } from './workbench'

export type { LayoutDescriptor } from './types'

export const BUILTIN_LAYOUTS: readonly LayoutDescriptor[] = Object.freeze([
  chatCanvasLayout,
  chatLayout,
  workbenchLayout,
  commandLayout,
  guidedLayout,
  missionLayout,
])

export const CLASSIC_TITLE = 'Classic'
export const APPEARANCE_SECTION_ID = 'appearance.layout'

/** A layout the server lists as its own (not a plugin's, which may reuse a disabled built-in's id). */
export function isBuiltinLayout(spec: Pick<ShellLayoutSpec, 'source'>): boolean {
  const s = spec.source
  return !s || s === 'builtin' || s.startsWith('builtin.') || s.startsWith('builtin:')
}

/** Offered layouts in picker order (`order`, then manifest order), and the classic frame last. */
export function layoutChoices(layouts: ShellLayouts): { id: string; title: string }[] {
  const offered = layouts.available
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.order ?? 100) - (b.s.order ?? 100) || a.i - b.i)
    .map(({ s }) => ({ id: s.id, title: s.title }))
  return [...offered, { id: '', title: CLASSIC_TITLE }]
}

function readChoice(): string | null {
  try {
    return parseLayoutChoice(window.localStorage.getItem(LAYOUT_STORAGE_KEY))
  } catch {
    return null
  }
}

/**
 * The picker's current value: the stored choice when it is offered, else the
 * server default when it is offered, else the classic frame (the shell's
 * selection without a preview).
 */
export function currentChoice(layouts: ShellLayouts, stored: string | null = readChoice()): string {
  const ok = (id: string | null): id is string => id !== null && (id === '' || layouts.available.some((s) => s.id === id))
  const pick = ok(stored) ? stored : ok(layouts.default) ? layouts.default : ''
  return pick || CLASSIC_LAYOUT_ID
}

function registerPicker(sdk: BuiltinSdk, layouts: ShellLayouts, looks: readonly string[]): void {
  const choices = layoutChoices(layouts)
  // Without a user choice the server's default stands; a switch lasts for this tab (like ?layout=).
  const persist = layouts.userChoice
  for (const c of choices) {
    sdk.registerCommand({
      id: `layouts.switch.${c.id || CLASSIC_LAYOUT_ID}`,
      title: `Switch layout: ${c.title}`,
      group: 'Layout',
      keywords: ['layout', 'frame', 'appearance', 'view', c.id || CLASSIC_LAYOUT_ID],
      icon: LayoutTemplate,
      run: () => sdk.setLayout(c.id, { persist }),
    })
  }
  // The look: each layout's own (named when there is one look), or plain Pro.
  const own = looks.length === 1 ? looks[0].charAt(0).toUpperCase() + looks[0].slice(1) : 'Layout default'
  for (const choice of looks.length ? (['layout', 'pro'] as const) : []) {
    sdk.registerCommand({
      id: `layouts.look.${choice}`,
      title: `Switch look: ${choice === 'pro' ? 'Pro' : own}`,
      group: 'Layout',
      keywords: ['look', 'theme', 'appearance', ...looks],
      icon: LayoutTemplate,
      run: () => setLookChoice(choice),
    })
  }
  if (!layouts.userChoice || !sdk.SDK_FEATURES.includes('settings')) return
  sdk.registerSettingsSection({
    id: APPEARANCE_SECTION_ID,
    title: 'Appearance',
    description: 'How the app is laid out. Saved in this browser.',
    order: 10,
    fields: [
      {
        key: 'layout',
        label: 'Layout',
        type: 'select',
        default: currentChoice(layouts, null),
        options: choices.map((c) => ({ value: c.id || CLASSIC_LAYOUT_ID, label: c.title })),
      },
    ],
    load: async () => ({ layout: currentChoice(layouts) }),
    save: async (values) => {
      const next = parseLayoutChoice(values.layout)
      if (next === null) throw new Error(`Unknown layout ${String(values.layout)}`)
      sdk.setLayout(next)
      return { layout: next || CLASSIC_LAYOUT_ID }
    },
  })
}

export function activateLayouts(sdk: BuiltinSdk, layouts: ShellLayouts | undefined, descriptors = BUILTIN_LAYOUTS): string[] {
  if (!layouts || layouts.available.length === 0) return []
  const registered: string[] = []
  const looks: string[] = []
  for (const spec of layouts.available) {
    const d = isBuiltinLayout(spec) && !spec.module ? descriptors.find((x) => x.id === spec.id) : undefined
    if (!d) continue
    sdk.registerLayout(d.id, d.meta, d.load)
    registered.push(d.id)
    if (d.meta.look && !looks.includes(d.meta.look)) looks.push(d.meta.look)
  }
  registerPicker(sdk, layouts, looks)
  if (sdk.SDK_FEATURES.includes('theme-presets')) {
    for (const preset of proThemePresets()) sdk.registerThemePreset(preset)
  }
  return registered
}

export const layoutsBuiltin: BuiltinPlugin = {
  name: 'builtin.layouts',
  pages: [],
  always: true,
  activate(sdk, { manifest }) {
    activateLayouts(sdk, manifest.layouts)
  },
}
