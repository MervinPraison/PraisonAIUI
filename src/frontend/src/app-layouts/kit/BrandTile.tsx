/**
 * The site's mark in a frame's chrome: the manifest's image logo, else a
 * single-colour glyph on the accent tile (white on primary, the same in
 * light and dark). A text logo that is a pictograph (an emoji mascot such as
 * the default lobster) is not drawn here: its colours muddy at 24 px and
 * clash with the accent, so the tile shows the PraisonAI glyph instead (an
 * SVG drawn on a 24 grid, crisp at 16, 24 and 32 px); the mascot is for the
 * new-chat hero only. A plain text logo ("AI") or the title's initial is
 * drawn as letters.
 */
import type { LayoutChrome } from '@/sdk/layouts'
import { cn } from '@/lib/utils'

const PICTOGRAPH = /\p{Extended_Pictographic}/u

/** What the tile shows: the image, the glyph, or these letters. */
export function brandGlyph(chrome: Pick<LayoutChrome, 'siteTitle' | 'siteLogo'>, letters = 1): { kind: 'img'; src: string } | { kind: 'glyph' } | { kind: 'text'; text: string } {
  const logo = chrome.siteLogo
  if (logo?.kind === 'img') return { kind: 'img', src: logo.value }
  const text = logo?.value?.trim()
  if (!text || PICTOGRAPH.test(text)) return text || !chrome.siteTitle.trim() ? { kind: 'glyph' } : { kind: 'text', text: chrome.siteTitle.trim().slice(0, letters).toUpperCase() }
  return { kind: 'text', text: text.slice(0, letters + 1) }
}

/** The PraisonAI glyph: a rounded P with a spark, in currentColor. */
export function PraisonGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} data-brand-glyph="">
      <path d="M8 19V5h5a4.5 4.5 0 0 1 0 9H8" />
      <circle cx="17.25" cy="18.25" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * The tile. `className` sizes and rounds it (e.g. "size-6 rounded-[7px]");
 * `glyphClassName` sizes the glyph or the letters inside.
 */
export function BrandTile({
  chrome,
  className,
  glyphClassName = 'size-[62%]',
  letters,
}: {
  chrome: Pick<LayoutChrome, 'siteTitle' | 'siteLogo'>
  className?: string
  glyphClassName?: string
  letters?: number
}) {
  const g = brandGlyph(chrome, letters)
  if (g.kind === 'img') return <img src={g.src} alt="" className={cn('shrink-0 object-cover', className)} />
  return (
    <span aria-hidden="true" data-brand-tile="" className={cn('flex shrink-0 items-center justify-center bg-primary font-semibold text-primary-foreground', className)}>
      {g.kind === 'glyph' ? <PraisonGlyph className={glyphClassName} /> : g.text}
    </span>
  )
}
