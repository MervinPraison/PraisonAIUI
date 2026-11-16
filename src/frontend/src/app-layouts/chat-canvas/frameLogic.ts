/** Pure pieces of the Chat and Canvas frame: layout options and keys. */
import type { CSSProperties } from 'react'
import { matchesShortcut } from '@/app-layouts/kit'

const positive = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined)

/**
 * CSS variables from YAML `layout.options.chat-canvas`: `collapseLines` (a
 * code block taller than this scrolls inside the thread while the canvas is
 * on, default 12) and `collapseRows` (the same for tables, default 6).
 */
export function optionVars(options: Record<string, unknown> | undefined): CSSProperties {
  const vars: Record<string, string> = {}
  const lines = positive(options?.collapseLines)
  const rows = positive(options?.collapseRows)
  if (lines) vars['--cc-collapse-lines'] = String(lines)
  if (rows) vars['--cc-collapse-rows'] = String(rows)
  return vars as CSSProperties
}

/**
 * YAML `layout.options.chat-canvas.artifactsInChat`: `card` (the default,
 * the design) shows an artifact the canvas holds as its card only; `inline`
 * keeps the block in the reply too (collapsed to collapseLines /
 * collapseRows) with the card under it.
 */
export function artifactsInChat(options: Record<string, unknown> | undefined): 'card' | 'inline' {
  return options?.artifactsInChat === 'inline' ? 'inline' : 'card'
}

export type FrameAction = 'new-chat' | 'toggle-sidebar'

/**
 * The frame's keys: ⌘N (Ctrl+N) starts a chat when the sessions feed is on,
 * ⌘B (Ctrl+B) hides or shows the sidebar on a desktop or tablet. Both work
 * while typing in the composer, like the design's hints say.
 */
export function frameKeyAction(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  ctx: { phone: boolean; canCreate: boolean; mac?: boolean },
): FrameAction | null {
  if (ctx.canCreate && matchesShortcut(e, 'mod+n', ctx.mac)) return 'new-chat'
  if (!ctx.phone && matchesShortcut(e, 'mod+b', ctx.mac)) return 'toggle-sidebar'
  return null
}
