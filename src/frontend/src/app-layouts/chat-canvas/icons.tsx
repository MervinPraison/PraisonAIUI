/**
 * Nav icons of the Chat and Canvas sidebar: a small static map of lucide
 * names (the manifest's `navIcon`, or a name in `icon`), then any other
 * lucide name (lazy), image URL or emoji the page declares (lib/PageGlyph),
 * falling back to the page's initial. Static first on purpose: a dynamic
 * lucide lookup would pull the whole icon set into the frame chunk.
 */
import { createElement } from 'react'
import type { LayoutNavItem } from '@/sdk/layouts'
import { PageGlyph } from '@/lib/PageGlyph'
import { iconFor } from './iconMap'

export function NavIcon({ item }: { item: LayoutNavItem }) {
  const Icon = iconFor(item)
  if (Icon) return createElement(Icon, { 'aria-hidden': true, className: 'size-4 shrink-0' })
  const mark = (
    <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center text-xs font-semibold">
      {item.title.slice(0, 1).toUpperCase()}
    </span>
  )
  return <PageGlyph navIcon={item.navIcon} icon={item.icon} className="size-4 shrink-0" fallback={mark} />
}
