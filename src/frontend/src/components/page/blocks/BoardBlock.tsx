/**
 * The `board` block: block props to the Board template. Registered
 * lazily by blocks/coreBlocks.tsx, in its own chunk. The template does not
 * depend on the block layer, so a React page uses it without the blocks chunk.
 */
import { useMemo } from 'react'
import { arr, display, isRecord, str } from '@/blocks/normalize'
import type { BlockNode } from '@/sdk/registry'
import { Board, type BoardCard, type BoardColumn } from '../Board'

function blockCard(raw: unknown, i: number): BoardCard | null {
  if (!isRecord(raw)) return null
  const p = isRecord(raw.props) ? { ...raw, ...raw.props } : raw
  const title = str(p.title ?? p.name ?? p.label, 'Card')
  return {
    id: str(p.id, `${i}-${title}`),
    title,
    ref: p.ref != null ? str(p.ref) : undefined,
    meta: p.priority != null ? display(p.priority) : undefined,
    body: p.value != null ? display(p.value) : p.description != null ? display(p.description) : undefined,
    footer: display(p.footer ?? p.assignee ?? p.status ?? '') || undefined,
  }
}

/** `{type: "board", columns: [{id, title, cards: [card() | {title, value, footer}]}]}` */
export function BoardBlock({ node }: { node: BlockNode }) {
  const p = node.props ?? {}
  const columns = useMemo<BoardColumn[]>(
    () =>
      arr(p.columns)
        .filter(isRecord)
        .map((c, i) => ({
          id: str(c.id, String(i)),
          title: str(c.title ?? c.id, 'Column'),
          limit: typeof c.limit === 'number' ? c.limit : undefined,
          cards: arr(c.cards)
            .map(blockCard)
            .filter((k): k is BoardCard => !!k),
        })),
    [p.columns],
  )
  return <Board label={str(p.title ?? p.label, 'Board')} columns={columns} />
}
