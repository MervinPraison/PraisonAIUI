/**
 * PraisonAI Pro token system at run time (ADR 0003): the accent swatches,
 * the `<html data-aiui-tokens>` switch and the swatch theme presets.
 *
 * Its own module, with no imports, so the shell (shell/LayoutHost.tsx) and
 * builtin.layouts load only this and not themes.ts, which the legacy React
 * App shares (a shared module lands whole in the boot path). themes.ts
 * re-exports the accent and token-system names. Python themes.PRO_ACCENTS holds the same table
 * (tests/unit/test_seed_theme.py keeps them equal).
 */

/** Accent roles; each is a `--seed-pro-<role>` seed. */
export const PRO_ACCENT_ROLES = ['accent', 'accent-fg', 'soft', 'link', 'ring'] as const
export type ProAccentRole = typeof PRO_ACCENT_ROLES[number]
export type ProAccentName = 'indigo' | 'blue' | 'teal' | 'graphite'
type ProAccentModes = Record<'light' | 'dark', Readonly<Record<ProAccentRole, string>>>

/** The design's four accent swatches. */
export const PRO_ACCENTS: Record<ProAccentName, ProAccentModes> = {
    indigo: {
        light: { 'accent': '#4f46e5', 'accent-fg': '#ffffff', 'soft': '#eef2ff', 'link': '#4338ca', 'ring': '#4f46e5' },
        dark: { 'accent': '#5b5ef0', 'accent-fg': '#ffffff', 'soft': '#1e1e3f', 'link': '#a5b4fc', 'ring': '#818cf8' },
    },
    blue: {
        light: { 'accent': '#2563eb', 'accent-fg': '#ffffff', 'soft': '#eff6ff', 'link': '#1d4ed8', 'ring': '#2563eb' },
        dark: { 'accent': '#60a5fa', 'accent-fg': '#0e0e11', 'soft': '#14233b', 'link': '#93c5fd', 'ring': '#60a5fa' },
    },
    teal: {
        light: { 'accent': '#0f766e', 'accent-fg': '#ffffff', 'soft': '#e6f4f1', 'link': '#115e59', 'ring': '#0f766e' },
        dark: { 'accent': '#2dd4bf', 'accent-fg': '#0e0e11', 'soft': '#0f2a27', 'link': '#5eead4', 'ring': '#2dd4bf' },
    },
    graphite: {
        light: { 'accent': '#18181b', 'accent-fg': '#ffffff', 'soft': '#f1f1f3', 'link': '#18181b', 'ring': '#52525b' },
        dark: { 'accent': '#ededf0', 'accent-fg': '#0e0e11', 'soft': '#26262c', 'link': '#ededf0', 'ring': '#a1a1aa' },
    },
}

export const PRO_DEFAULT_ACCENT: ProAccentName = 'indigo'

/** `<html>` attribute that switches styles/pro.css on. */
export const TOKEN_SYSTEM_ATTR = 'data-aiui-tokens'
export type TokenSystem = 'pro'

/**
 * Switch the Pro token system on (`'pro'`) or back to the classic tokens
 * (`null`). Only `styles/pro.css` reads the attribute, so nothing else
 * paints differently. The shell's layout host (shell/LayoutHost.tsx) calls
 * it: 'pro' while a layout frame is mounted, null for the classic frame.
 */
export function setTokenSystem(system: TokenSystem | null, root?: HTMLElement): void {
    const el = root ?? (typeof document === 'undefined' ? null : document.documentElement)
    if (!el) return
    if (system) el.setAttribute(TOKEN_SYSTEM_ATTR, system)
    else el.removeAttribute(TOKEN_SYSTEM_ATTR)
}

/** The active token system, or null for the classic tokens. */
export function getTokenSystem(root?: HTMLElement): TokenSystem | null {
    const el = root ?? (typeof document === 'undefined' ? null : document.documentElement)
    return el?.getAttribute(TOKEN_SYSTEM_ATTR) === 'pro' ? 'pro' : null
}

// ── looks ────────────────────────────────────────────────────────────
// A look is a variant of the Pro tokens a layout paints with by default
// (its meta.look, e.g. Chat + Canvas's "paper"; CSS in styles/paper.css).
// The viewer may prefer plain Pro everywhere: a per-viewer convenience in
// localStorage, kept in memory too when storage is blocked.

/** localStorage: `pro` when the viewer chose plain Pro over a layout's own look. */
export const LOOK_STORAGE_KEY = 'aiui-look'
export type LookChoice = 'layout' | 'pro'

let lookChoice: LookChoice | undefined
const lookListeners = new Set<() => void>()

/** The viewer's look choice (`layout` unless they picked plain Pro). */
export function getLookChoice(): LookChoice {
    if (!lookChoice) {
        try {
            lookChoice = localStorage.getItem(LOOK_STORAGE_KEY) === 'pro' ? 'pro' : 'layout'
        } catch {
            lookChoice = 'layout'
        }
    }
    return lookChoice
}

/** Choose the layout's own look or plain Pro; saved in this browser and applied at once. */
export function setLookChoice(choice: LookChoice): void {
    lookChoice = choice
    try {
        if (choice === 'pro') localStorage.setItem(LOOK_STORAGE_KEY, choice)
        else localStorage.removeItem(LOOK_STORAGE_KEY)
    } catch {
        /* kept for this page only */
    }
    lookListeners.forEach((fn) => fn())
}

/** Called when the look choice changes (useSyncExternalStore). */
export function subscribeLookChoice(fn: () => void): () => void {
    lookListeners.add(fn)
    return () => lookListeners.delete(fn)
}

/** Per-mode `--seed-pro-<role>` seeds for one swatch (registerThemePreset light/dark). */
export function proAccentSeeds(name: ProAccentName): Record<'light' | 'dark', Record<string, string>> {
    const swatch = PRO_ACCENTS[name]
    const seeds = (mode: 'light' | 'dark') =>
        Object.fromEntries(PRO_ACCENT_ROLES.map((role) => [`--seed-pro-${role}`, swatch[mode][role]]))
    return { light: seeds('light'), dark: seeds('dark') }
}

const PRO_ACCENT_LABELS: Record<ProAccentName, string> = {
    indigo: 'Indigo',
    blue: 'Blue',
    teal: 'Teal',
    graphite: 'Graphite',
}

/**
 * The four Pro accents as theme presets, ready for `registerThemePreset`
 * (ids `pro.<name>`). They set only `--seed-pro-*` seeds, so they recolour
 * layouts and leave the classic frame alone.
 */
export function proThemePresets(): { id: string; label: string; light: Record<string, string>; dark: Record<string, string> }[] {
    return (Object.keys(PRO_ACCENTS) as ProAccentName[]).map((name) => ({
        id: `pro.${name}`,
        label: `Pro ${PRO_ACCENT_LABELS[name]}`,
        ...proAccentSeeds(name),
    }))
}
