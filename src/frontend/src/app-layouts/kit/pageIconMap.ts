/**
 * Page icon names for layout frames: the shared static lucide table
 * (lib/pageIcons.ts, also the shell's: frames may not import @/shell, R17),
 * read by a nav item's `navIcon` (or a name in `icon`).
 */
import type { LucideIcon } from 'lucide-react'
import { iconByName } from '@/lib/pageIcons'
import type { LayoutNavItem } from '@/sdk/layouts'

/** The lucide icon a nav item names (`navIcon`, else a name in `icon`), if any. */
export function iconForNavItem(item: Pick<LayoutNavItem, 'navIcon' | 'icon'>): LucideIcon | undefined {
  return iconByName(item.navIcon) ?? iconByName(item.icon)
}
