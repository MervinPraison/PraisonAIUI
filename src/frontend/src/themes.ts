// Theme runtime for the React UI.
//
// Colours are a token layer (src/styles/theme.css, documented in DESIGN.md):
// a handful of L0 *seeds* (--seed-accent, --seed-ink, --seed-paper, ...) from
// which every shadcn variable (--background, --primary, ...) is derived as a
// full colour. Runtime code only ever writes seeds: named presets, colour
// presets and legacy HSL-triple custom CSS are all converted to seeds here.
// The Python side (themes.get_seed_theme_css) emits the same seeds from the
// same tables, so server-rendered and runtime themes agree.

// Available theme presets - these are just identifiers
// The actual colors come from the generated CSS at build time
export const THEME_PRESETS = [
    'zinc',      // Neutral gray
    'slate',     // Cool gray  
    'stone',     // Warm gray
    'gray',      // Gray
    'neutral',   // True gray
    'red',       // Red accent
    'orange',    // Orange accent
    'amber',     // Amber accent
    'yellow',    // Yellow accent
    'lime',      // Lime accent
    'green',     // Green accent
    'emerald',   // Emerald accent
    'teal',      // Teal accent
    'cyan',      // Cyan accent
    'sky',       // Sky accent
    'blue',      // Blue accent
    'indigo',    // Indigo accent
    'violet',    // Violet accent
    'purple',    // Purple accent
    'fuchsia',   // Fuchsia accent
    'pink',      // Pink accent
    'rose',      // Rose accent
] as const

// Named theme presets (like Gradio's themes)
export const NAMED_THEME_PRESETS = {
    soft: {
        base: 'slate',
        darkMode: false,
        radius: 'lg',
        styles: {
            '--background': '0 0% 98%',
            '--foreground': '222.2 84% 4.9%',
            '--card': '0 0% 100%',
            '--card-foreground': '222.2 84% 4.9%',
            '--primary': '221.2 83.2% 53.3%',
            '--primary-foreground': '210 40% 98%',
            '--muted': '210 40% 96.1%',
            '--muted-foreground': '215.4 16.3% 46.9%',
            '--accent': '210 40% 96.1%',
            '--accent-foreground': '222.2 47.4% 11.2%',
        },
    },
    glass: {
        base: 'slate',
        darkMode: true,
        radius: 'xl',
        styles: {
            '--background': '222.2 84% 4.9%',
            '--foreground': '210 40% 98%',
            '--card': '222.2 84% 4.9% / 0.8',
            '--card-foreground': '210 40% 98%',
            '--primary': '217.2 91.2% 59.8%',
            '--primary-foreground': '222.2 47.4% 11.2%',
            '--muted': '217.2 32.6% 17.5%',
            '--muted-foreground': '215 20.2% 65.1%',
            '--accent': '217.2 32.6% 17.5%',
            '--accent-foreground': '210 40% 98%',
        },
    },
    dark: {
        base: 'zinc',
        darkMode: true,
        radius: 'md',
        styles: {
            '--background': '0 0% 3.9%',
            '--foreground': '0 0% 98%',
            '--card': '0 0% 3.9%',
            '--card-foreground': '0 0% 98%',
            '--primary': '0 0% 98%',
            '--primary-foreground': '0 0% 9%',
            '--muted': '0 0% 14.9%',
            '--muted-foreground': '0 0% 63.9%',
            '--accent': '0 0% 14.9%',
            '--accent-foreground': '0 0% 98%',
        },
    },
    ocean: {
        base: 'cyan',
        darkMode: true,
        radius: 'lg',
        styles: {
            '--background': '200 50% 3%',
            '--foreground': '180 100% 90%',
            '--card': '200 50% 5%',
            '--card-foreground': '180 100% 90%',
            '--primary': '180 100% 50%',
            '--primary-foreground': '200 50% 3%',
            '--muted': '200 30% 15%',
            '--muted-foreground': '180 30% 60%',
            '--accent': '180 80% 30%',
            '--accent-foreground': '180 100% 90%',
        },
    },
    citrus: {
        base: 'yellow',
        darkMode: false,
        radius: 'lg',
        styles: {
            '--background': '60 100% 97%',
            '--foreground': '20 14.3% 4.1%',
            '--card': '60 100% 99%',
            '--card-foreground': '20 14.3% 4.1%',
            '--primary': '47.9 95.8% 53.1%',
            '--primary-foreground': '26 83.3% 14.1%',
            '--muted': '60 4.8% 95.9%',
            '--muted-foreground': '25 5.3% 44.7%',
            '--accent': '60 4.8% 95.9%',
            '--accent-foreground': '20 14.3% 4.1%',
        },
    },
    monochrome: {
        base: 'neutral',
        darkMode: true,
        radius: 'none',
        styles: {
            '--background': '0 0% 0%',
            '--foreground': '0 0% 100%',
            '--card': '0 0% 5%',
            '--card-foreground': '0 0% 100%',
            '--primary': '0 0% 100%',
            '--primary-foreground': '0 0% 0%',
            '--muted': '0 0% 15%',
            '--muted-foreground': '0 0% 65%',
            '--accent': '0 0% 20%',
            '--accent-foreground': '0 0% 100%',
        },
    },
} as const

export type NamedThemePreset = keyof typeof NAMED_THEME_PRESETS

export const THEME_STORAGE_KEY = 'aiui-theme-preference'

export type ThemePreference = 'light' | 'dark' | 'system'

export const RADIUS_PRESETS = {
    none: '0',
    sm: '0.3rem',
    md: '0.5rem',
    lg: '0.75rem',
    xl: '1rem',
} as const

export type ThemePreset = typeof THEME_PRESETS[number]

export type RadiusPreset = keyof typeof RADIUS_PRESETS

// CSS variable names that shadcn/Tailwind expects
export const CSS_VARIABLE_NAMES = [
    '--background',
    '--foreground',
    '--card',
    '--card-foreground',
    '--popover',
    '--popover-foreground',
    '--primary',
    '--primary-foreground',
    '--secondary',
    '--secondary-foreground',
    '--muted',
    '--muted-foreground',
    '--accent',
    '--accent-foreground',
    '--destructive',
    '--destructive-foreground',
    '--border',
    '--input',
    '--ring',
    '--radius',
] as const

/**
 * Apply radius preset to the document
 * Colors are already applied via CSS from build process
 */
export function applyRadius(radiusPreset: RadiusPreset): void {
    const radius = RADIUS_PRESETS[radiusPreset] || RADIUS_PRESETS.md
    document.documentElement.style.setProperty('--radius', radius)
}

/**
 * Toggle dark mode class on document
 */
export function applyDarkMode(enabled: boolean): void {
    if (enabled) {
        document.documentElement.classList.add('dark')
    } else {
        document.documentElement.classList.remove('dark')
    }
}

/**
 * Check if dark mode is currently enabled
 */
export function isDarkMode(): boolean {
    return document.documentElement.classList.contains('dark')
}

const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'
let systemQuery: MediaQueryList | null = null
let onSystemChange: (() => void) | null = null

/**
 * 'System' mode: apply the OS scheme now and on every OS change (the app
 * shell gets the same from next-themes); any other mode stops following it.
 */
function followSystemScheme(follow: boolean): void {
    if (!follow) {
        if (systemQuery && onSystemChange) systemQuery.removeEventListener('change', onSystemChange)
        systemQuery = null
        onSystemChange = null
        return
    }
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    if (!systemQuery) {
        const query = window.matchMedia(SYSTEM_DARK_QUERY)
        const listener = () => applyDarkMode(query.matches)
        query.addEventListener('change', listener)
        systemQuery = query
        onSystemChange = listener
    }
    applyDarkMode(systemQuery.matches)
}

/**
 * Apply stored user theme preference over YAML default dark mode.
 */
export function applyStoredThemePreference(yamlDefaultDark: boolean): void {
    let stored: string | null = null
    try {
        stored = localStorage.getItem(THEME_STORAGE_KEY)
    } catch {
        return
    }
    followSystemScheme(stored === 'system')
    if (stored === 'light') {
        applyDarkMode(false)
    } else if (stored === 'dark') {
        applyDarkMode(true)
    } else if (stored !== 'system') {
        applyDarkMode(yamlDefaultDark)
    }
}

/**
 * Persist and apply a theme preference.
 */
export function setThemePreference(preference: ThemePreference): void {
    try {
        localStorage.setItem(THEME_STORAGE_KEY, preference)
    } catch {
        // ignore storage failures
    }
    followSystemScheme(preference === 'system')
    if (preference !== 'system') applyDarkMode(preference === 'dark')
}

/**
 * Get list of available theme presets
 */
export function getThemeNames(): readonly string[] {
    return THEME_PRESETS
}

/**
 * Get list of available radius presets
 */
export function getRadiusNames(): readonly string[] {
    return Object.keys(RADIUS_PRESETS) as RadiusPreset[]
}

// Backward compatibility alias
export const SHADCN_THEMES = THEME_PRESETS

// ── Seeds ────────────────────────────────────────────────────────────────

/** Neutral presets: the accent follows the ink (monochrome); only the tint changes. */
export const NEUTRAL_TINTS: Record<string, string> = {
    zinc: '#71717a',
    slate: '#64748b',
    stone: '#78716c',
    gray: '#6b7280',
    neutral: '#737373',
}

/**
 * Colour preset accents. `dark` is the Tailwind 500 shade (the same table as
 * Python features/theme.py PRESET_COLORS); `light` is the 600 shade, so the
 * accent reads on white. Mirrors Python themes.PRESET_ACCENTS (a pytest keeps
 * the two identical).
 */
export const PRESET_ACCENTS: Record<string, { light: string; dark: string }> = {
    red: { light: '#dc2626', dark: '#ef4444' },
    orange: { light: '#ea580c', dark: '#f97316' },
    amber: { light: '#d97706', dark: '#f59e0b' },
    yellow: { light: '#ca8a04', dark: '#eab308' },
    lime: { light: '#65a30d', dark: '#84cc16' },
    green: { light: '#16a34a', dark: '#22c55e' },
    emerald: { light: '#059669', dark: '#10b981' },
    teal: { light: '#0d9488', dark: '#14b8a6' },
    cyan: { light: '#0891b2', dark: '#06b6d4' },
    sky: { light: '#0284c7', dark: '#0ea5e9' },
    blue: { light: '#2563eb', dark: '#3b82f6' },
    indigo: { light: '#4f46e5', dark: '#6366f1' },
    violet: { light: '#7c3aed', dark: '#8b5cf6' },
    purple: { light: '#9333ea', dark: '#a855f7' },
    fuchsia: { light: '#c026d3', dark: '#d946ef' },
    pink: { light: '#db2777', dark: '#ec4899' },
    rose: { light: '#e11d48', dark: '#f43f5e' },
}

/** How much a colour preset's accent tints fills and strokes. */
export const COLOR_PRESET_ACCENT_MIX = '4%'

export type SeedVars = Record<string, string>

/** Seeds for a YAML colour or neutral preset (unknown names fall back to zinc). */
export function presetSeedVars(preset: string): SeedVars {
    const accents = PRESET_ACCENTS[preset]
    if (accents) {
        return {
            '--seed-tint': NEUTRAL_TINTS.zinc,
            '--accent-mix': COLOR_PRESET_ACCENT_MIX,
            '--seed-accent-light': accents.light,
            '--seed-accent-dark': accents.dark,
        }
    }
    return {
        '--seed-tint': NEUTRAL_TINTS[preset] ?? NEUTRAL_TINTS.zinc,
        '--seed-accent': 'var(--seed-ink)',
        '--accent-mix': '0%',
    }
}

// Old shadcn variable -> the seed it is now derived from. Every other variable
// (--card-foreground, --muted-foreground, --accent, --border, ...) is derived.
const LEGACY_TO_SEED: Record<string, string> = {
    '--primary': '--seed-accent',
    '--primary-foreground': '--seed-accent-fg',
    '--background': '--seed-paper',
    '--foreground': '--seed-ink',
    '--card': '--seed-raised',
    '--popover': '--seed-raised',
    '--muted': '--seed-sunken',
    '--destructive': '--seed-danger',
    '--radius': '--radius',
}

/** shadcn variables that used to hold bare HSL triples (`221 83% 53%`). */
export const LEGACY_HSL_VARS = [
    'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
    'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted',
    'muted-foreground', 'accent', 'accent-foreground', 'destructive', 'destructive-foreground',
    'border', 'input', 'ring', 'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
    'sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground',
    'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring',
] as const

// `221.2 83.2% 53.3%`, `0 0% 3.9% / 0.8`, `200deg 50% 3%`
const TRIPLE = String.raw`-?[\d.]+(?:deg)?\s+[\d.]+%\s+[\d.]+%(?:\s*\/\s*[\d.]+%?)?`
const HSL_TRIPLE = new RegExp(String.raw`^\s*${TRIPLE}\s*$`)

/** Wrap a bare HSL triple as hsl(...); any other value is returned trimmed. */
export function legacyColorValue(raw: string): string {
    return HSL_TRIPLE.test(raw) ? `hsl(${raw.trim()})` : raw.trim()
}

/**
 * Convert old-style shadcn variables (HSL triples or colours) into seeds.
 * The first variable that maps to a seed wins (--card beats --popover).
 */
export function legacyVarsToSeeds(vars: Record<string, string>): SeedVars {
    const out: SeedVars = {}
    for (const [key, raw] of Object.entries(vars)) {
        const seed = LEGACY_TO_SEED[key]
        if (!seed || seed in out || typeof raw !== 'string') continue
        out[seed] = legacyColorValue(raw)
    }
    return out
}

const LEGACY_DECL = new RegExp(
    String.raw`(^|[;{\s])--(${LEGACY_HSL_VARS.join('|')})\s*:\s*(${TRIPLE})\s*(!important)?\s*(?=;|\})`,
    'g',
)

/**
 * Upgrade user CSS written for the old HSL-triple format. Each
 * `--primary: 221 83% 53%` becomes `--primary: hsl(221 83% 53%)` (a valid full
 * colour again) and, when the variable has a seed, also sets the seed
 * (`--seed-accent: hsl(221 83% 53%)`) so the derived tokens follow it.
 * Idempotent: values already wrapped in a colour function are left alone.
 */
export function upgradeLegacyCss(css: string): string {
    return css.replace(LEGACY_DECL, (_m, lead: string, name: string, triple: string, imp?: string) => {
        const value = `hsl(${triple.trim()})`
        const bang = imp ? ' !important' : ''
        const seed = LEGACY_TO_SEED[`--${name}`]
        const seedDecl = seed && seed !== `--${name}` ? `; ${seed}: ${value}${bang}` : ''
        return `${lead}--${name}: ${value}${bang}${seedDecl}`
    })
}

/** `:root { ... }` text for a set of seeds. Unsafe names or values are dropped. */
export function seedCss(vars: SeedVars, selector = ':root'): string {
    const decls = Object.entries(vars)
        .filter(([k, v]) => /^--[a-z0-9-]+$/.test(k) && typeof v === 'string' && !/[;{}<>]/.test(v))
        .map(([k, v]) => `${k}: ${v};`)
        .join(' ')
    return `${selector} { ${decls} }`
}

const RUNTIME_SEEDS_ID = 'aiui-runtime-seeds'

/**
 * How runtime seeds rank against the other unlayered seed sources
 * (server `<style id="aiui-server-theme">`, build-time assets/theme.css and
 * user custom CSS, all of which use `:root`):
 *
 * - `'fallback'` (`:where(:root)`, specificity 0): a YAML preset. Any server or
 *   build-time seed wins, because the server also knows overrides the browser
 *   config does not carry (theme.accent, set_brand_color). Values are the same
 *   tables, so the fallback only matters when no server seed tag exists.
 * - `'override'` (`html:root`, specificity 0,1,1): a named preset (soft, glass,
 *   ...), which the server cannot express. Beats `:root` seeds the way the old
 *   inline styles did.
 */
export type SeedPriority = 'fallback' | 'override'

const SEED_SELECTOR: Record<SeedPriority, string> = {
    fallback: ':where(:root)',
    override: 'html:root',
}

/**
 * Write seeds as one unlayered <style> in <head> (never inline styles, so a
 * user's custom CSS can still override them). Each call replaces the
 * previous runtime seeds.
 */
export function applySeedVars(vars: SeedVars, priority: SeedPriority = 'fallback'): void {
    if (typeof document === 'undefined') return
    let el = document.getElementById(RUNTIME_SEEDS_ID) as HTMLStyleElement | null
    if (!el) {
        el = document.createElement('style')
        el.id = RUNTIME_SEEDS_ID
        document.head.insertBefore(el, document.getElementById('aiui-custom-css'))
    }
    el.textContent = seedCss(vars, SEED_SELECTOR[priority])
}

/**
 * Rewrite <style id="aiui-custom-css"> (set_custom_css / site.custom_css) in
 * place when it still uses HSL triples. Safe to call repeatedly.
 */
export function upgradeLegacyCustomCss(): void {
    if (typeof document === 'undefined') return
    const el = document.getElementById('aiui-custom-css')
    if (!el || !el.textContent) return
    const next = upgradeLegacyCss(el.textContent)
    if (next !== el.textContent) el.textContent = next
}

/**
 * Apply a named theme preset (soft, glass, dark, ocean, citrus, monochrome)
 */
export function applyNamedTheme(presetName: NamedThemePreset): void {
    const preset = NAMED_THEME_PRESETS[presetName]
    if (!preset) return

    applyDarkMode(preset.darkMode)
    const radius = RADIUS_PRESETS[preset.radius as RadiusPreset] ?? RADIUS_PRESETS.md
    applySeedVars(
        {
            ...presetSeedVars(preset.base),
            ...legacyVarsToSeeds(preset.styles),
            '--radius': radius,
        },
        'override',
    )
    upgradeLegacyCustomCss()
    document.documentElement.dataset.theme = presetName
}

/**
 * Apply theme settings to the document.
 *
 * Supports both color presets (zinc, blue, etc.) and named presets (soft, glass, etc.)
 *
 * @param preset - Theme preset name
 * @param darkMode - Whether to enable dark mode
 * @param radiusPreset - Border radius preset
 */
export function applyTheme(
    preset: string = 'zinc',
    darkMode: boolean = true,
    radiusPreset: string = 'md'
): void {
    if (preset in NAMED_THEME_PRESETS) {
        applyNamedTheme(preset as NamedThemePreset)
        return
    }

    applyDarkMode(darkMode)
    const radius = RADIUS_PRESETS[radiusPreset as RadiusPreset] ?? RADIUS_PRESETS.md
    applySeedVars({ ...presetSeedVars(preset), '--radius': radius })
    upgradeLegacyCustomCss()
    document.documentElement.dataset.theme = preset
}
