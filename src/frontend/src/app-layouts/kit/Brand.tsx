import type { LayoutChrome } from '@/sdk/layouts'
import { cn } from '@/lib/utils'
import type { KitSize } from './rows'

/**
 * The site's mark and title at the top of a frame's sidebar (Pro: a 24 px
 * ink tile, 15 px semibold title; 16 px on touch). The logo is the
 * manifest's (`site.logo`); without one, the title's first letter.
 */
export function Brand({ chrome, size = 'default', className }: { chrome: Pick<LayoutChrome, 'siteTitle' | 'siteLogo'>; size?: KitSize; className?: string }) {
  const logo = chrome.siteLogo
  return (
    <span className={cn('flex min-w-0 items-center gap-2 text-foreground', className)}>
      {logo?.kind === 'img' ? (
        <img src={logo.value} alt="" className="size-6 shrink-0 rounded-md" />
      ) : (
        <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-[7px] bg-foreground text-xs font-semibold text-background">
          {logo?.value ?? chrome.siteTitle.slice(0, 1)}
        </span>
      )}
      <span className={cn('truncate font-semibold tracking-tight', size === 'touch' ? 'text-base' : 'text-[15px]')}>{chrome.siteTitle}</span>
    </span>
  )
}
