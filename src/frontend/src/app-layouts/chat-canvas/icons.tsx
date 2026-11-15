/**
 * Nav icons of the Chat and Canvas sidebar: a small static map of lucide
 * names (the manifest's `navIcon`, or a name in `icon`), falling back to
 * the page's initial (never its emoji). Static on purpose: a dynamic
 * lucide lookup would pull the whole icon set into the frame chunk.
 */
import { createElement } from 'react'
import type { LayoutNavItem } from '@/sdk/layouts'
import { iconFor } from './iconMap'

export function NavIcon({ item }: { item: LayoutNavItem }) {
  const Icon = iconFor(item)
  if (Icon) return createElement(Icon, { 'aria-hidden': true, className: 'size-4 shrink-0' })
  // Never the page's emoji (it renders differently on every OS): its initial.
  const mark = item.title.slice(0, 1).toUpperCase()
  return (
    <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center text-xs font-semibold">
      {mark}
    </span>
  )
}
