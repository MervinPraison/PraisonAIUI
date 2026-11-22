/**
 * A nav item's icon for layout frames: its lucide icon (./pageIconMap), else
 * any other lucide name (lazy), an image URL or an emoji the page declares
 * (lib/PageGlyph), else its first letter.
 */
import { createElement } from 'react'
import type { LayoutNavItem } from '@/sdk/layouts'
import { PageGlyph } from '@/lib/PageGlyph'
import { cn } from '@/lib/utils'
import { iconForNavItem } from './pageIconMap'

/** A nav item's first letter, the icon of a page that declares none. */
function NavLetter({ title, className }: { title: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('flex size-4 shrink-0 items-center justify-center text-xs leading-none font-semibold', className)}>
      {title.slice(0, 1).toUpperCase()}
    </span>
  )
}

/** A nav item's icon (decorative): lucide, else the page's declared icon, else its first letter. */
export function NavIcon({ item, className }: { item: Pick<LayoutNavItem, 'navIcon' | 'icon' | 'title'>; className?: string }) {
  const Icon = iconForNavItem(item)
  if (Icon) return createElement(Icon, { 'aria-hidden': true, className: cn('size-4 shrink-0', className) })
  return (
    <PageGlyph navIcon={item.navIcon} icon={item.icon} className={cn('size-4 shrink-0', className)} fallback={<NavLetter title={item.title} className={className} />} />
  )
}
