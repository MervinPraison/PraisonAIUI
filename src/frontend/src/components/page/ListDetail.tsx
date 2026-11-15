/**
 * List + detail page template (ProList.dc.html): a toolbar, a dense table
 * with a sticky header, keyboard selection (↑/↓ move, Enter open, Esc close),
 * an optional detail panel beside it and a pagination footer.
 *
 * Used by React pages directly, and by the `list_detail` block
 * (ListDetailBlock below, registered lazily by blocks/coreBlocks.tsx).
 */
import { useEffect, useId, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { isStackedBelow, moveSelection, pageRange } from './model'
import { Glyph } from './parts'
import './page.css'

export interface ListColumn<R> {
  key: string
  label: string
  /** Numbers and times line up at the end. */
  align?: 'start' | 'end'
  render?: (row: R) => ReactNode
}

export interface ListSort {
  key: string
  dir: 'asc' | 'desc'
}

export interface ListDetailProps<R extends { id: string }> {
  /** Accessible name of the table ("Sessions"). */
  label: string
  columns: readonly ListColumn<R>[]
  rows: readonly R[]
  selectedId?: string | null
  onSelect?: (id: string | null) => void
  /** Enter on a row, or a double click. */
  onOpen?: (id: string) => void
  sort?: ListSort
  onSort?: (key: string) => void
  /** Search, filters and the primary action, above the table. */
  toolbar?: ReactNode
  /** The panel for the selected row; shown while a row is selected. */
  detail?: ReactNode
  detailTitle?: ReactNode
  /** Shown in place of the rows when there are none. */
  empty?: ReactNode
  /** Pagination (ListPagination) or a note, below the table. */
  footer?: ReactNode
  className?: string
}

function cellOf<R extends { id: string }>(row: R, col: ListColumn<R>): ReactNode {
  if (col.render) return col.render(row)
  const v = (row as Record<string, unknown>)[col.key]
  if (v == null) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function ListDetail<R extends { id: string }>({
  label,
  columns,
  rows,
  selectedId,
  onSelect,
  onOpen,
  sort,
  onSort,
  toolbar,
  detail,
  detailTitle,
  empty,
  footer,
  className,
}: ListDetailProps<R>) {
  const detailId = useId()
  const ids = useMemo(() => rows.map((r) => r.id), [rows])
  const mainRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLElement>(null)
  /** A pointer selection asks for the panel to be brought on screen. */
  const reveal = useRef(false)
  const focusRow = (table: HTMLElement | null, id: string | null) => {
    if (!table || id == null) return
    const el = table.querySelector<HTMLElement>(`tr[data-row-id="${CSS.escape(id)}"]`)
    el?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTableSectionElement>) => {
    const tbody = e.currentTarget
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = moveSelection(ids, selectedId, e.key === 'ArrowDown' ? 1 : -1)
      onSelect?.(next)
      focusRow(tbody, next)
    } else if (e.key === 'Enter' && selectedId) {
      e.preventDefault()
      onOpen?.(selectedId)
    } else if (e.key === 'Escape' && selectedId) {
      e.preventDefault()
      onSelect?.(null)
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const next = ids.length ? ids[e.key === 'Home' ? 0 : ids.length - 1] : null
      onSelect?.(next)
      focusRow(tbody, next)
    }
  }

  const showDetail = selectedId != null && detail != null

  // On a phone the panel stacks under the whole table, off screen: after a tap
  // scroll it into view and move focus to it. Beside the table (desktop) the
  // focus stays on the row, so arrow keys keep browsing.
  useEffect(() => {
    if (!reveal.current || !showDetail) return
    reveal.current = false
    const aside = detailRef.current
    const main = mainRef.current
    if (!aside || !main || !isStackedBelow(aside.getBoundingClientRect(), main.getBoundingClientRect())) return
    aside.scrollIntoView?.({ block: 'start' })
    aside.focus({ preventScroll: true })
  }, [selectedId, showDetail])

  const closeDetail = () => {
    const id = selectedId ?? null
    onSelect?.(null)
    // Back to the row the panel described (the panel is gone after this render).
    requestAnimationFrame(() => focusRow(mainRef.current, id))
  }

  return (
    <div className={['aiui-tpl aiui-tpl-list', className].filter(Boolean).join(' ')} data-aiui-template="list">
      {toolbar && (
        <div role="toolbar" aria-label={`Filter and sort ${label.toLowerCase()}`} className="aiui-tpl-toolbar">
          {toolbar}
        </div>
      )}
      <div className="aiui-tpl-list-body">
        <div className="aiui-tpl-list-main" ref={mainRef}>
          {rows.length === 0 && empty ? (
            <div className="aiui-tpl-empty">{empty}</div>
          ) : (
            <table className="aiui-tpl-table" aria-label={label} aria-rowcount={rows.length + 1}>
              <thead>
                <tr>
                  {columns.map((col) => {
                    const sorted = sort?.key === col.key
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        data-align={col.align === 'end' ? 'end' : undefined}
                        aria-sort={sorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                      >
                        {onSort ? (
                          <button type="button" className="aiui-tpl-sort" onClick={() => onSort(col.key)}>
                            {col.label}
                            {sorted && <Glyph name={sort.dir === 'asc' ? 'up' : 'down'} />}
                          </button>
                        ) : (
                          col.label
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody onKeyDown={onKeyDown}>
                {rows.map((row, i) => {
                  const selected = row.id === selectedId
                  // Roving tab stop: the selected row, else the first.
                  const tabbable = selected || (i === 0 && !ids.includes(selectedId ?? ''))
                  return (
                    <tr
                      key={row.id}
                      data-row-id={row.id}
                      aria-selected={selected}
                      aria-controls={showDetail && selected ? detailId : undefined}
                      tabIndex={tabbable ? 0 : -1}
                      onClick={() => {
                        reveal.current = true
                        onSelect?.(row.id)
                      }}
                      onDoubleClick={() => onOpen?.(row.id)}
                    >
                      {columns.map((col) => (
                        <td key={col.key} data-align={col.align === 'end' ? 'end' : undefined}>
                          {cellOf(row, col)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {footer}
        </div>
        {showDetail && (
          <aside
            id={detailId}
            ref={detailRef}
            tabIndex={-1}
            className="aiui-tpl-detail"
            aria-label={typeof detailTitle === 'string' ? detailTitle : 'Details'}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                closeDetail()
              }
            }}
          >
            <div className="aiui-tpl-detail-head">
              <h2>{detailTitle}</h2>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Close details" title="Close details (Esc)" onClick={closeDetail}>
                <Glyph name="close" />
              </Button>
            </div>
            <div className="aiui-tpl-detail-body">{detail}</div>
          </aside>
        )}
      </div>
    </div>
  )
}

/** "1–8 of 42", ↑/↓ and Enter hints, previous and next page. */
export function ListPagination({
  page,
  pageSize,
  total,
  onPage,
  hints = true,
}: {
  page: number
  pageSize: number
  total: number
  onPage?: (page: number) => void
  hints?: boolean
}) {
  const { from, to, pages } = pageRange(page, pageSize, total)
  return (
    <nav aria-label="Pagination" className="aiui-tpl-pager">
      <span className="aiui-tpl-meta">
        {from}–{to} of {total}
      </span>
      {hints && (
        <span className="aiui-tpl-hints">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>Enter</Kbd> open
          </span>
        </span>
      )}
      <span className="aiui-tpl-grow" />
      {pages > 1 && (
        <>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage?.(page - 1)}>
            <Glyph name="left" />
          </Button>
          <span className="aiui-tpl-meta">
            {Math.min(page, pages)} / {pages}
          </span>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => onPage?.(page + 1)}>
            <Glyph name="right" />
          </Button>
        </>
      )}
    </nav>
  )
}

export default ListDetail
