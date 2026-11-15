/** Shared row styles and link handling for the kit (Pro spec: 32 px rows, 44 px on touch). */
import type { MouseEvent } from 'react'
import { cn } from '@/lib/utils'

export type KitSize = 'default' | 'touch'

/** A primary-button click without modifiers: the frame navigates itself; others go to the browser. */
export function isPlainLeftClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented
}

/** A sidebar row (nav link, session): 8 px radius, the active one on `sidebar-accent`. */
export const navRowClass = (size: KitSize, active = false) =>
  cn(
    'flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left text-sidebar-foreground outline-none transition-colors',
    'hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-ring',
    size === 'touch' ? 'h-11 text-[15px]' : 'h-8 text-sm',
    active && 'bg-sidebar-accent font-medium text-foreground',
  )
