/**
 * Copy, close and arrow glyphs (the lucide shapes the design uses). Drawn here
 * because lucide's Copy, X, ArrowUp and ArrowDown modules are also in the chat route: sharing
 * them would split each into its own chunk and grow that route's budget.
 */
import type { JSX, SVGProps } from 'react'

type GlyphProps = SVGProps<SVGSVGElement> & { strokeWidth?: number }

function Glyph({ children, strokeWidth = 2, ...p }: GlyphProps & { children: JSX.Element | JSX.Element[] }): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...p}>
      {children}
    </svg>
  )
}

export function CopyGlyph(p: GlyphProps): JSX.Element {
  return (
    <Glyph {...p}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </Glyph>
  )
}

export function ArrowUpGlyph(p: GlyphProps): JSX.Element {
  return (
    <Glyph {...p}>
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </Glyph>
  )
}

export function ArrowDownGlyph(p: GlyphProps): JSX.Element {
  return (
    <Glyph {...p}>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </Glyph>
  )
}

export function CloseGlyph(p: GlyphProps): JSX.Element {
  return (
    <Glyph {...p}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </Glyph>
  )
}

export function ChevronGlyph(p: GlyphProps): JSX.Element {
  return (
    <Glyph {...p}>
      <path d="m9 18 6-6-6-6" />
    </Glyph>
  )
}
