/**
 * One copy of an artifact on screen: the reply shows its card, the canvas
 * shows the artifact. The cards region marks the blocks of its reply that
 * ARE one of that reply's artifacts with `data-in-canvas` (on the markdown
 * block that holds them), and a layout's stylesheet hides them (Chat +
 * Canvas: `layout.options.chat-canvas.artifactsInChat`, `card` by default).
 * A short snippet below the artifact thresholds is no artifact: it stays.
 *
 * Matched by content, not position, so it holds however the renderer nests
 * blocks: a code block is an artifact's text (whitespace aside) (while the reply streams, one
 * may be a prefix of the other); a table has a table artifact's header.
 * A mermaid fence renders as a diagram, not a code block: it stays inline.
 */
import { useLayoutEffect, type RefObject } from 'react'
import { plainText } from './derive'

export const IN_CANVAS = 'data-in-canvas'

type Shown = { kind: string; content?: string; columns?: readonly string[] }

// Whitespace is ignored: the highlighter draws each line as a block span
// with no newline between them, so a code block's textContent has none.
const norm = (s: string) => s.replace(/\s+/g, '')

/** A rendered code block's text is one of these artifacts (`streaming`: a prefix either way counts). */
export function codeIsArtifact(text: string, shown: readonly Shown[], streaming = false): boolean {
  const t = norm(text)
  if (!t) return false
  return shown.some((a) => {
    if ((a.kind !== 'code' && a.kind !== 'markdown') || a.content === undefined) return false
    const c = norm(a.content)
    return c === t || (streaming && !!c && (c.startsWith(t) || t.startsWith(c)))
  })
}

const sig = (cells: readonly string[]) => cells.map((c) => plainText(c).toLowerCase().replace(/\s+/g, ' ').trim()).join('|')

/** A rendered table's header cells are a table artifact's columns. */
export function tableIsArtifact(header: readonly string[], shown: readonly Shown[]): boolean {
  if (!header.length) return false
  const s = sig(header)
  return shown.some((a) => a.kind === 'table' && !!a.columns?.length && sig(a.columns) === s)
}

/** The element to hide for a block: it, or the wrapper it is the only child of (up to the markdown root). */
function hideTarget(el: Element, root: Element): Element {
  let cur = el
  while (cur.parentElement && cur.parentElement !== root && cur.parentElement.childElementCount === 1) cur = cur.parentElement
  return cur
}

/** Mark the reply's artifact blocks under `message` (and unmark the rest). Returns how many are marked. */
export function markInCanvas(message: Element, shown: readonly Shown[], streaming = false): number {
  const want = new Set<Element>()
  for (const root of message.querySelectorAll('.aiui-markdown')) {
    if (root.closest('[data-part="reasoning"]')) continue
    for (const code of root.querySelectorAll('[data-aiui-code]')) {
      if (codeIsArtifact(code.querySelector('pre')?.textContent ?? '', shown, streaming)) want.add(hideTarget(code, root))
    }
    for (const table of root.querySelectorAll('table')) {
      const header = [...table.querySelectorAll('thead th')].map((th) => th.textContent ?? '')
      if (tableIsArtifact(header, shown)) want.add(hideTarget(table, root))
    }
  }
  for (const el of message.querySelectorAll(`[${IN_CANVAS}]`)) if (!want.has(el)) el.removeAttribute(IN_CANVAS)
  for (const el of want) el.setAttribute(IN_CANVAS, '')
  return want.size
}

/**
 * Keep the marks of the reply that holds `anchor` current while it renders
 * and streams (a MutationObserver, one pass per frame); removed on unmount.
 */
export function useMarkInCanvas(anchor: RefObject<Element | null>, shown: readonly Shown[] | undefined, streaming: boolean): void {
  useLayoutEffect(() => {
    const message = anchor.current?.closest('[data-role="assistant"]')
    if (!message || !shown?.length || typeof MutationObserver === 'undefined') return
    let frame = 0
    const run = () => {
      frame = 0
      markInCanvas(message, shown, streaming)
    }
    run()
    const mo = new MutationObserver(() => {
      frame ||= requestAnimationFrame(run)
    })
    mo.observe(message, { childList: true, subtree: true, characterData: true })
    return () => {
      mo.disconnect()
      cancelAnimationFrame(frame)
      markInCanvas(message, [])
    }
  }, [anchor, shown, streaming])
}
