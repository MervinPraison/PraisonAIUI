/**
 * Board page template (ProBoard.dc.html): columns of cards on a sunken
 * surface, a count and an optional work-in-progress limit per column, and
 * keyboard moves (Space picks a card up, arrows move it, Space or Enter
 * drops it, Esc cancels) announced in a live status bar.
 *
 * Used by React pages directly, and by the `board` block (BoardBlock below,
 * registered lazily by blocks/coreBlocks.tsx; same props as `aiui.board()`).
 */
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { findCard, stepGrab, type GrabState } from './model'
import './page.css'

export interface BoardCard {
  id: string
  title: string
  /** Mono reference shown top-left ("T-148"). */
  ref?: string
  /** Top-right meta (priority, age). */
  meta?: ReactNode
  /** One line under the title. */
  body?: ReactNode
  /** Status chip, due date, agent… */
  footer?: ReactNode
  href?: string
}

export interface BoardColumn {
  id: string
  title: string
  cards: readonly BoardCard[]
  /** Work-in-progress limit: the count turns into "n / limit" when over. */
  limit?: number
  /** Next to the count (e.g. "This week"). */
  aside?: ReactNode
}

export interface BoardProps {
  /** Accessible name ("Task board"). */
  label: string
  columns: readonly BoardColumn[]
  /** Enables keyboard moves; called on drop. */
  onMove?: (cardId: string, toColumn: string, index: number) => void
  /** Above the columns (filters). */
  toolbar?: ReactNode
  className?: string
}

function sizesWithout(columns: readonly BoardColumn[], cardId: string): number[] {
  return columns.map((c) => c.cards.filter((k) => k.id !== cardId).length)
}

export function Board({ label, columns, onMove, toolbar, className }: BoardProps) {
  const [grab, setGrab] = useState<GrabState | null>(null)
  const [status, setStatus] = useState('')
  const titleOf = (id: string) => columns.flatMap((c) => c.cards).find((c) => c.id === id)?.title ?? id

  const announce = (g: GrabState) => {
    const col = columns[g.col]
    const size = sizesWithout(columns, g.cardId)[g.col] + 1
    setStatus(`Moving ${titleOf(g.cardId)} to ${col?.title ?? ''}, position ${g.index + 1} of ${size}`)
  }

  const onCardKey = (e: KeyboardEvent<HTMLElement>, cardId: string) => {
    if (!onMove) return
    if (e.key === ' ' || e.key === 'Enter') {
      if (grab && grab.cardId === cardId) {
        e.preventDefault()
        const to = columns[grab.col]
        if (to) onMove(cardId, to.id, grab.index)
        setStatus(`Dropped ${titleOf(cardId)} in ${to?.title ?? ''}, position ${grab.index + 1}`)
        setGrab(null)
      } else if (e.key === ' ') {
        e.preventDefault()
        const at = findCard(columns, cardId)
        if (!at) return
        const g = { cardId, col: at.col, index: at.index }
        setGrab(g)
        announce(g)
      }
      return
    }
    if (e.key === 'Escape' && grab) {
      e.preventDefault()
      setGrab(null)
      setStatus(`Cancelled moving ${titleOf(cardId)}`)
      return
    }
    if (grab && grab.cardId === cardId && e.key.startsWith('Arrow')) {
      e.preventDefault()
      const next = stepGrab(grab, e.key, sizesWithout(columns, cardId))
      setGrab(next)
      announce(next)
    }
  }

  return (
    <div className={['aiui-tpl aiui-tpl-board', className].filter(Boolean).join(' ')} data-aiui-template="board">
      {toolbar && (
        <div role="toolbar" aria-label={`Filter ${label.toLowerCase()}`} className="aiui-tpl-toolbar">
          {toolbar}
        </div>
      )}
      <div className="aiui-tpl-board-scroll">
        <div className="aiui-tpl-board-cols" role="group" aria-label={label}>
          {columns.map((col, ci) => {
            const count = col.cards.length
            const over = col.limit != null && count > col.limit
            const headingId = `aiui-board-${ci}-${col.id}`
            return (
              <section
                key={col.id}
                className="aiui-tpl-col"
                aria-labelledby={headingId}
                data-target={grab && grab.col === ci ? 'true' : undefined}
              >
                <div className="aiui-tpl-col-head">
                  <h2 id={headingId}>{col.title}</h2>
                  <span className="aiui-tpl-count">{count}</span>
                  <span className="aiui-tpl-grow" />
                  {col.limit != null && (
                    <span data-over={over || undefined} title="Work-in-progress limit">
                      {over && <TriangleAlert aria-hidden width={12} height={12} />}
                      {count} / {col.limit} limit
                    </span>
                  )}
                  {col.aside && <span className="aiui-tpl-meta">{col.aside}</span>}
                </div>
                <ul className="aiui-tpl-cards">
                  {col.cards.map((card) => (
                    <li key={card.id}>
                      <article
                        className="aiui-tpl-card"
                        tabIndex={0}
                        aria-roledescription={onMove ? 'draggable card' : 'card'}
                        aria-label={card.title}
                        data-grabbed={grab?.cardId === card.id ? 'true' : undefined}
                        onKeyDown={(e) => onCardKey(e, card.id)}
                      >
                        {(card.ref || card.meta) && (
                          <div className="aiui-tpl-card-top">
                            <span>{card.ref}</span>
                            <span className="aiui-tpl-grow" />
                            {card.meta}
                          </div>
                        )}
                        <h3>{card.href ? <a href={card.href}>{card.title}</a> : card.title}</h3>
                        {card.body != null && card.body !== '' && <p className="aiui-tpl-card-body">{card.body}</p>}
                        {card.footer != null && card.footer !== '' && <div className="aiui-tpl-card-foot">{card.footer}</div>}
                      </article>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      </div>
      {onMove && (
        <div className="aiui-tpl-statusbar">
          <span role="status" aria-live="assertive">
            {status}
          </span>
          <span className="aiui-tpl-grow" />
          <span>Space: pick up or drop · Arrows: move · Esc: cancel</span>
        </div>
      )}
    </div>
  )
}

export default Board
