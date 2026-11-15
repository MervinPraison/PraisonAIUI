/**
 * Page icons for the shell: the manifest names each page's icon. Built-in
 * pages carry `navIcon` (their `icon` is the emoji the legacy dashboard
 * shows), and a plugin may put a name in `icon`. The page id never decides.
 * The name table lives in lib/pageIcons.ts, shared with the layout kit.
 *
 * Resolution (PageIcon.tsx): `navIcon` → a name in `icon` → the emoji in
 * `icon` → FileText.
 */
import type { LucideIcon } from 'lucide-react'
import { iconByName } from '@/lib/pageIcons'
import type { ShellPage } from '@/sdk/manifest'

export { FallbackPageIcon, ICON_BY_NAME, PAGE_ICON_SET } from '@/lib/pageIcons'

/** First emoji cluster (with ZWJ / variation-selector tails) in a string. */
const EMOJI_CLUSTER = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}️?)*/u

/**
 * The lucide icon for a page, or undefined when it has none: its `navIcon`,
 * else a name in `icon`. An app or plugin page that reuses a built-in id
 * shows the icon it declares.
 */
export function iconForPage(page: Pick<ShellPage, 'icon' | 'navIcon'>): LucideIcon | undefined {
  return iconByName(page.navIcon) ?? iconByName(page.icon)
}

/** The emoji to show for a page without a lucide icon, if `page.icon` has one. */
export function emojiForPage(page: Pick<ShellPage, 'icon'>): string | undefined {
  if (typeof page.icon !== 'string' || page.icon.length > 32) return undefined
  return EMOJI_CLUSTER.exec(page.icon)?.[0]
}
