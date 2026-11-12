import { createElement } from 'react'
import type { ShellPage } from '@/sdk/manifest'
import { cn } from '@/lib/utils'
import { emojiForPage, FallbackPageIcon, iconForPage } from './icons'

/** A page's sidebar/palette icon: lucide from the static map, else its emoji, else FileText. */
export function PageIcon({ page, className }: { page: Pick<ShellPage, 'id' | 'icon'>; className?: string }) {
  const Icon = iconForPage(page)
  // createElement: the icon is a static module-level component picked from a map.
  if (Icon) return createElement(Icon, { 'aria-hidden': true, className: cn('size-4 shrink-0', className) })
  const emoji = emojiForPage(page)
  if (emoji) {
    return (
      <span
        aria-hidden="true"
        className={cn('inline-flex size-4 shrink-0 items-center justify-center text-xs leading-none', className)}
      >
        {emoji}
      </span>
    )
  }
  return <FallbackPageIcon aria-hidden="true" className={cn('size-4 shrink-0', className)} />
}
