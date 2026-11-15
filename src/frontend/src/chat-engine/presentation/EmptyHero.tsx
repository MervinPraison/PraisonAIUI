/**
 * A new chat inside a layout: the brand moment. The site's mark (the image
 * logo, a plain text logo, or else the PraisonAI glyph on the accent tile; an
 * emoji mascot reads as a toy at this size, so it gets the glyph too) and its
 * name as a 44px wordmark, one line saying what to expect, then
 * the starter cards; the thread centres all of it with the composer
 * (viewport.css). A layout with its own `empty` region (Guided's templates)
 * keeps that instead.
 */
import type { JSX, ReactNode } from 'react'
import { useManifest } from '@/sdk/services'

export const HERO_PROMISE = 'Ask anything. Your agents show each step and check with you before anything risky.'

/** The hero's mark: an image URL, plain text letters, or the PraisonAI glyph (no logo, or an emoji). */
// eslint-disable-next-line react-refresh/only-export-components -- shared with tests and sibling modules
export function heroMark(logo: unknown): { kind: 'img'; src: string } | { kind: 'text'; text: string } | { kind: 'glyph' } {
  if (typeof logo !== 'string' || !logo.trim()) return { kind: 'glyph' }
  const v = logo.trim()
  if (/^(\/|https?:|data:image\/|blob:)/.test(v)) return { kind: 'img', src: v }
  return /\p{Extended_Pictographic}/u.test(v) ? { kind: 'glyph' } : { kind: 'text', text: v.slice(0, 4) }
}

export function EmptyHero({ children }: { children: ReactNode }): JSX.Element {
  const site = useManifest()?.site ?? {}
  const title = typeof site.title === 'string' && site.title.trim() ? site.title.trim() : 'PraisonAI'
  const mark = heroMark(site.logo)
  return (
    <>
      <div className="flex flex-col items-center gap-3" data-chat-hero="">
        <div className="flex items-center gap-3">
          {mark.kind === 'img' && <img src={mark.src} alt="" className="size-11 rounded-xl" />}
          {mark.kind === 'text' && (
            <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground">
              {mark.text}
            </span>
          )}
          {mark.kind === 'glyph' && (
            <span aria-hidden="true" data-brand-tile="" className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              {/* The PraisonAI glyph (as in the layout kit's BrandTile; inlined so the chat engine keeps layout-kit out of its chunk). */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-7" data-brand-glyph="">
                <path d="M8 19V5h5a4.5 4.5 0 0 1 0 9H8" />
                <circle cx="17.25" cy="18.25" r="1.25" fill="currentColor" stroke="none" />
              </svg>
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
