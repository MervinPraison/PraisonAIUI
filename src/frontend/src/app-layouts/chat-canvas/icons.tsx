/**
 * Nav icons of the Chat and Canvas sidebar: a small static map of lucide
 * names (the manifest's `navIcon`, or a name in `icon`), falling back to a
 * page's short mark (its emoji) or its initial. Static on purpose: a dynamic
 * lucide lookup would pull the whole icon set into the frame chunk.
 */
import { createElement } from 'react'
import type { LayoutNavItem } from '@/sdk/layouts'
import { iconFor } from './iconMap'

export function NavIcon({ item }: { item: LayoutNavItem }) {
  const Icon = iconFor(item)
  if (Icon) return createElement(Icon, { 'aria-hidden': true, className: 'size-4 shrink-0' })
  const mark = item.icon && item.icon.length <= 4 ? item.icon : item.title.slice(0, 1).toUpperCase()
  return (
    <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center text-xs opacity-80 grayscale">
      {mark}
    </span>
  )
}
