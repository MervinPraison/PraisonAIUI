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
 * Apply theme settings to the document.
 * 
 * Note: Colors are now applied via CSS at build time, not runtime.
 * This function only sets radius and dark mode.
 * 
 * @param preset - Theme preset name (for future use with dynamic loading)
 * @param darkMode - Whether to enable dark mode
 * @param radiusPreset - Border radius preset
 */
export function applyTheme(
    preset: string = 'zinc',
    darkMode: boolean = true,
    radiusPreset: string = 'md'
): void {
    // Apply dark mode class
    applyDarkMode(darkMode)

    // Apply radius
    const radius = RADIUS_PRESETS[radiusPreset as RadiusPreset] || RADIUS_PRESETS.md
    document.documentElement.style.setProperty('--radius', radius)

    // Store preset for potential dynamic loading
    document.documentElement.dataset.theme = preset
}
