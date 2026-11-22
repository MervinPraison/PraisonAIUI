/**
 * What a page's manifest icon fields point at (lib/PageGlyph draws it): a
 * lucide name, an image URL or an emoji. Kept apart from the components so
 * fast refresh works (react-refresh/only-export-components).
 */
export type PageGlyphSource = { kind: 'url'; src: string } | { kind: 'emoji'; text: string } | { kind: 'name'; name: string }

/** http(s) or a root path; never `//host`, `javascript:` or `data:`. */
const IMAGE_URL = /^(?:https?:\/\/[^\s"'<>]+|\/(?!\/)[^\s"'<>]*)$/i
const ICON_NAME = /^[a-z][a-z0-9-]{0,59}$/
/** First emoji cluster (with ZWJ / variation-selector tails) in a string. */
const EMOJI_CLUSTER = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}\uFE0F?)*/u

/** The server's `icon` default for `@aiui.page` / `register_page`: no icon chosen, so the caller's fallback draws. */
const DEFAULT_PAGE_ICON = '\u{1F4C4}'

/** What a page's icon fields point at, or undefined when neither names an icon. */
export function pageGlyphSource(navIcon?: unknown, icon?: unknown): PageGlyphSource | undefined {
  for (const raw of [navIcon, icon]) {
    if (typeof raw !== 'string') continue
    const value = raw.trim()
    if (!value || value === DEFAULT_PAGE_ICON || value.length > 2048) continue
    if (IMAGE_URL.test(value)) return { kind: 'url', src: value }
    const name = value.toLowerCase()
    if (ICON_NAME.test(name)) return { kind: 'name', name }
    const emoji = value.length <= 32 ? EMOJI_CLUSTER.exec(value)?.[0] : undefined
    if (emoji) return { kind: 'emoji', text: emoji }
  }
  return undefined
}
