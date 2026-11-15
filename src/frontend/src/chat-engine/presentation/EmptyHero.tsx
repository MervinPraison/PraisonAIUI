/**
 * A new chat inside a layout: the brand moment. The site's mark (the image
 * logo, or the text logo such as the multi-colour mascot, which only appears
 * here) and its name as a 44px wordmark, one line saying what to expect, then
 * the starter cards; the thread centres all of it with the composer
 * (viewport.css). A layout with its own `empty` region (Guided's templates)
 * keeps that instead.
 */
import type { JSX, ReactNode } from 'react'
import { useManifest } from '@/sdk/services'

export const HERO_PROMISE = 'Ask anything. Your agents show each step and check with you before anything risky.'

/** The hero's mark: an image URL, a text mascot, or none. */
export function heroMark(logo: unknown): { kind: 'img'; src: string } | { kind: 'text'; text: string } | null {
  if (typeof logo !== 'string' || !logo.trim()) return null
  const v = logo.trim()
  return /^(\/|https?:|data:image\/|blob:)/.test(v) ? { kind: 'img', src: v } : { kind: 'text', text: v.slice(0, 4) }
}

export function EmptyHero({ children }: { children: ReactNode }): JSX.Element {
  const site = useManifest()?.site ?? {}
  const title = typeof site.title === 'string' && site.title.trim() ? site.title.trim() : 'PraisonAI'
  const mark = heroMark(site.logo)
  return (
    <>
      <div className="flex flex-col items-center gap-3" data-chat-hero="">
        <div className="flex items-center gap-3">
          {mark?.kind === 'img' && <img src={mark.src} alt="" className="size-11 rounded-xl" />}
          {mark?.kind === 'text' && (
            <span aria-hidden="true" className="text-[40px] leading-none">
              {mark.text}
            </span>
          )}
          <h2 className="m-0 text-[44px] leading-none font-semibold tracking-tight text-foreground">{title}</h2>
        </div>
        <p className="m-0 max-w-xl text-base text-balance text-muted-foreground">{HERO_PROMISE}</p>
      </div>
      {children}
    </>
  )
}
