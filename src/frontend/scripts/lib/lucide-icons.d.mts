import type { Plugin } from 'vite'

export const ICON_BUCKETS: number
export const ICON_NAMES_FILE: string
export function iconBucket(name: string): number
export function lucideIconNodes(esmDir: string): Promise<{ nodes: Record<string, [string, Record<string, string>][]>; aliases: Record<string, string> }>
export function lucideIcons(root: string): Plugin
