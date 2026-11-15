/**
 * A nav item's icon for layout frames: its lucide icon (./pageIconMap), else
 * its first letter. Never its emoji: emoji render differently on every OS.
 */
import { createElement } from 'react'
import type { LayoutNavItem } from '@/sdk/layouts'
import { cn } from '@/lib/utils'
import { iconForNavItem } from './pageIconMap'

/** A nav item's icon (decorative): lucide, else its first letter. */
export function NavIcon({ item, className }: { item: Pick<LayoutNavItem, 'navIcon' | 'icon' | 'title'>; className?: string }) {
  const Icon = iconForNavItem(item)
  if (Icon) return createElement(Icon, { 'aria-hidden': true, className: cn('size-4 shrink-0', className) })
  return (
    <span aria-hidden="true" className={cn('flex size-4 shrink-0 items-center justify-center text-xs leading-none font-semibold', className)}>
      {item.title.slice(0, 1).toUpperCase()}
    </span>
  )
}
