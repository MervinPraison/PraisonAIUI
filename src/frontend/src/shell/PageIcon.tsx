import { createElement } from 'react'
import type { ShellPage } from '@/sdk/manifest'
import { PageGlyph } from '@/lib/PageGlyph'
import { cn } from '@/lib/utils'
import { FallbackPageIcon, iconForPage } from './icons'

/**
 * A page's sidebar/palette icon: lucide from the static map, else any other
 * lucide name (lazy), an image URL or an emoji (lib/PageGlyph), else FileText.
 */
export function PageIcon({ page, className }: { page: Pick<ShellPage, 'icon' | 'navIcon'>; className?: string }) {
  const Icon = iconForPage(page)
  // createElement: the icon is a static module-level component picked from a map.
  if (Icon) return createElement(Icon, { 'aria-hidden': true, className: cn('size-4 shrink-0', className) })
  const size = cn('size-4 shrink-0', className)
  return <PageGlyph navIcon={page.navIcon} icon={page.icon} className={size} fallback={<FallbackPageIcon aria-hidden="true" className={size} />} />
}
