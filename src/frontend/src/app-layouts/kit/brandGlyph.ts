/** What a frame's brand tile shows (./BrandTile): the image, the glyph, or a text logo's letters. */
import type { LayoutChrome } from '@/sdk/layouts'

const PICTOGRAPH = /\p{Extended_Pictographic}/u

/** What the tile shows: the image, the glyph, or a text logo's letters. */
export function brandGlyph(chrome: Pick<LayoutChrome, 'siteTitle' | 'siteLogo'>, letters = 1): { kind: 'img'; src: string } | { kind: 'glyph' } | { kind: 'text'; text: string } {
  const logo = chrome.siteLogo
  if (logo?.kind === 'img') return { kind: 'img', src: logo.value }
  const text = logo?.value?.trim()
  if (!text || PICTOGRAPH.test(text)) return { kind: 'glyph' }
  return { kind: 'text', text: text.slice(0, letters + 1) }
}
