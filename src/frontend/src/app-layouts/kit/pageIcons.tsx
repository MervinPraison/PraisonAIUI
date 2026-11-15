/**
 * A nav item's icon for layout frames: its lucide icon (./pageIconMap), else
 * its emoji, else its first letter.
 */
import { createElement } from 'react'
import type { LayoutNavItem } from '@/sdk/layouts'
import { cn } from '@/lib/utils'
import { iconForNavItem } from './pageIconMap'

const EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}️?)*/u

/** A nav item's icon (decorative): lucide, else its emoji, else its first letter. */
export function NavIcon({ item, className }: { item: Pick<LayoutNavItem, 'navIcon' | 'icon' | 'title'>; className?: string }) {
  const Icon = iconForNavItem(item)
  if (Icon) return createElement(Icon, { 'aria-hidden': true, className: cn('size-4 shrink-0', className) })
  const emoji = typeof item.icon === 'string' && item.icon.length <= 32 ? EMOJI.exec(item.icon)?.[0] : undefined
  return (
    <span
      aria-hidden="true"
      className={cn('flex size-4 shrink-0 items-center justify-center text-xs leading-none', emoji && 'opacity-70 grayscale', className)}
    >
      {emoji ?? item.title.slice(0, 1).toUpperCase()}
    </span>
  )
}
