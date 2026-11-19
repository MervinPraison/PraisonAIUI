/**
 * A new chat inside a layout: the brand moment. The site's mark (the image
 * logo, a plain text logo, or else the PraisonAI glyph on the accent tile; an
 * emoji mascot reads as a toy at this size, so it gets the glyph too) and its
 * name as a wordmark (44px, smaller on a phone; a name too long for one row
 * wraps below the mark), one line saying what to expect (the app's greeting, `@aiui.welcome`, when it has one: the greeting is the message),
 * then the starter cards; the thread centres all of it with the composer
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

export function EmptyHero({ welcome, children }: { welcome?: string; children: ReactNode }): JSX.Element {
  const site = useManifest()?.site ?? {}
  const title = typeof site.title === 'string' && site.title.trim() ? site.title.trim() : 'PraisonAI'
  const mark = heroMark(site.logo)
  return (
    <>
      <div className="flex flex-col items-center gap-3" data-chat-hero="">
        {/* The mark sits beside the name; a name too long for that row wraps
            below it, centred (not beside a two-line name on a phone). */}
        <div className="flex max-w-full flex-wrap items-center justify-center gap-3" data-chat-hero-brand="">
          {mark.kind === 'img' && <img src={mark.src} alt="" className="size-11 shrink-0 rounded-xl" />}
          {mark.kind === 'text' && (
            <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-lg font-semibold text-primary-foreground">
              {mark.text}
            </span>
          )}
          {mark.kind === 'glyph' && (
            <span aria-hidden="true" data-brand-tile="" className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              {/* The PraisonAI glyph (as in the layout kit's BrandTile; inlined so the chat engine keeps layout-kit out of its chunk). */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="size-7" data-brand-glyph="">
                <path d="M8 19V5h5a4.5 4.5 0 0 1 0 9H8M17.25 18.25h0" />
              </svg>
            </span>
          )}
          <h2 className="m-0 min-w-0 text-center text-[length:clamp(2rem,9vw,2.75rem)] leading-[1.05] font-semibold tracking-tight text-balance break-words text-foreground">
            {title}
          </h2>
        </div>
        <p
          className={`m-0 max-w-xl text-base text-balance whitespace-pre-line ${welcome ? 'text-foreground' : 'text-muted-foreground'}`}
          data-welcome={welcome ? '' : undefined}
        >
          {welcome || HERO_PROMISE}
        </p>
      </div>
      {children}
    </>
  )
}
