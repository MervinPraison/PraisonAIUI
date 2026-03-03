// Minimal theme system - no hardcoded colors
// Colors are loaded from YAML config at build time and injected as CSS variables
// This follows the principle of not hardcoding designs

// Available theme presets - these are just identifiers
// The actual colors come from the generated CSS at build time
export const THEME_PRESETS = [
    'zinc',      // Neutral gray
    'slate',     // Cool gray  
    'stone',     // Warm gray
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

export type ThemePreset = typeof THEME_PRESETS[number]

export const RADIUS_PRESETS = {
    none: '0',
    sm: '0.3rem',
    md: '0.5rem',
    lg: '0.75rem',
    xl: '1rem',
} as const

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

/**
 * Apply a named theme preset (soft, glass, dark, ocean, citrus, monochrome)
 */
export function applyNamedTheme(presetName: NamedThemePreset): void {
    const preset = NAMED_THEME_PRESETS[presetName]
    if (!preset) return

    // Apply dark mode
    applyDarkMode(preset.darkMode)

    // Apply radius
    const radius = RADIUS_PRESETS[preset.radius as RadiusPreset] || RADIUS_PRESETS.md
    document.documentElement.style.setProperty('--radius', radius)

    // Apply custom styles
    for (const [key, value] of Object.entries(preset.styles)) {
        document.documentElement.style.setProperty(key, value)
    }

    // Store preset name
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
    // Check if it's a named theme preset
    if (preset in NAMED_THEME_PRESETS) {
        applyNamedTheme(preset as NamedThemePreset)
        return
    }

    // Apply dark mode class
    applyDarkMode(darkMode)

    // Apply radius
    const radius = RADIUS_PRESETS[radiusPreset as RadiusPreset] || RADIUS_PRESETS.md
    document.documentElement.style.setProperty('--radius', radius)

    // Store preset for potential dynamic loading
    document.documentElement.dataset.theme = preset
}
