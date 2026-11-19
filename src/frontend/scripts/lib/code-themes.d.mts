import type { Plugin } from 'vite'

export const CODE_FILE: string
export const DEFAULT_THEMES: string[]
export function trimTheme(theme: Record<string, unknown>): Record<string, unknown>
export function codeThemes(): Plugin
