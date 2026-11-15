import type { LayoutChrome } from '@/sdk/layouts'
import { cn } from '@/lib/utils'
import { BrandTile } from './BrandTile'
import type { KitSize } from './rows'

/**
 * The site's mark and title at the top of a frame's sidebar (Pro: a 24 px
 * accent tile with a white mark, the same in light and dark, 15 px semibold title; 16 px on touch). The mark
 * is ./BrandTile's: the manifest's image logo, a text logo, or the single-colour PraisonAI glyph.
 */
export function Brand({ chrome, size = 'default', className }: { chrome: Pick<LayoutChrome, 'siteTitle' | 'siteLogo'>; size?: KitSize; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2 text-foreground', className)}>
      <BrandTile chrome={chrome} className={cn('size-6 text-xs', chrome.siteLogo?.kind === 'img' ? 'rounded-md' : 'rounded-[7px]')} />
      <span className={cn('truncate font-semibold tracking-tight', size === 'touch' ? 'text-base' : 'text-[15px]')}>{chrome.siteTitle}</span>
    </span>
  )
}
