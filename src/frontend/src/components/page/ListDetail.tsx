/**
 * List + detail page template (ProList.dc.html): a toolbar, a dense table
 * with a sticky header, keyboard selection (↑/↓ move, Enter open, Esc close),
 * an optional detail panel beside it and a pagination footer.
 *
 * Used by React pages directly, and by the `list_detail` block
 * (ListDetailBlock below, registered lazily by blocks/coreBlocks.tsx).
 */
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { arr, display, isRecord, num, str } from '@/blocks/normalize'
import type { BlockNode } from '@/sdk/registry'
import { moveSelection, pageRange } from './model'
import { Facts, TemplateSearch } from './parts'
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
  return display((row as Record<string, unknown>)[col.key])
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
  return (
    <div className={['aiui-tpl aiui-tpl-list', className].filter(Boolean).join(' ')} data-aiui-template="list">
      {toolbar && (
        <div role="toolbar" aria-label={`Filter and sort ${label.toLowerCase()}`} className="aiui-tpl-toolbar">
          {toolbar}
        </div>
      )}
      <div className="aiui-tpl-list-body">
        <div className="aiui-tpl-list-main">
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
                            {sorted && (sort.dir === 'asc' ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />)}
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
                      onClick={() => onSelect?.(row.id)}
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
          <aside id={detailId} className="aiui-tpl-detail" aria-label={typeof detailTitle === 'string' ? detailTitle : 'Details'}>
            <div className="aiui-tpl-detail-head">
              <h2>{detailTitle}</h2>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Close details" title="Close details (Esc)" onClick={() => onSelect?.(null)}>
                <X aria-hidden />
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
            <ChevronLeft aria-hidden />
          </Button>
          <span className="aiui-tpl-meta">
            {Math.min(page, pages)} / {pages}
          </span>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => onPage?.(page + 1)}>
            <ChevronRight aria-hidden />
          </Button>
        </>
      )}
    </nav>
  )
}

// ── `list_detail` block ──────────────────────────────────────────────

type Row = { id: string; values: Record<string, unknown> }

function blockColumns(spec: unknown, rows: Record<string, unknown>[]): ListColumn<Row>[] {
  const declared = arr(spec)
    .map((c) =>
      typeof c === 'string'
        ? { key: c, label: c }
        : isRecord(c)
          ? { key: str(c.key ?? c.id), label: str(c.label ?? c.title ?? c.key ?? c.id), align: c.align === 'end' || c.align === 'right' ? ('end' as const) : undefined }
          : null,
    )
    .filter((c): c is NonNullable<typeof c> => !!c && !!c.key)
  const keys = declared.length
    ? declared
    : Object.keys(rows[0] ?? {})
        .filter((k) => k !== 'id' && k !== 'detail')
        .map((k) => ({ key: k, label: k }))
  return keys.map((c) => ({ ...c, render: (r: Row) => display(r.values[c.key]) }))
}

/**
 * `{type: "list_detail", title, columns: [{key, label, align}] | ["a", "b"],
 *   rows: [{id, ...values, detail: {...}}], page_size, empty}`
 * Search filters the rows on the client; selecting a row shows its values and
 * its `detail` dict as key facts.
 */
export function ListDetailBlock({ node }: { node: BlockNode }) {
  const p = node.props ?? {}
  const raw = useMemo(() => arr(p.rows).filter(isRecord), [p.rows])
  const rows: Row[] = useMemo(() => raw.map((r, i) => ({ id: str(r.id, String(i)), values: r })), [raw])
  const columns = useMemo(() => blockColumns(p.columns, raw), [p.columns, raw])
  const pageSize = Math.max(1, num(p.page_size ?? p.pageSize, 25))
  const title = str(p.title ?? p.label, 'Items')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)

  const q = query.trim().toLowerCase()
  const filtered = q ? rows.filter((r) => columns.some((c) => display(r.values[c.key]).toLowerCase().includes(q))) : rows
  const { from, to } = pageRange(page, pageSize, filtered.length)
  const visible = filtered.slice(Math.max(0, from - 1), to)
  const current = rows.find((r) => r.id === selected)
  const first = columns[0]?.key

  const facts = current
    ? [
        ...columns.slice(1).map((c) => ({ label: c.label, value: display(current.values[c.key]) })),
        ...(isRecord(current.values.detail)
          ? Object.entries(current.values.detail).map(([k, v]) => ({ label: k, value: display(v) }))
          : []),
      ]
    : []

  return (
    <ListDetail
      label={title}
      columns={columns}
      rows={visible}
      selectedId={selected}
      onSelect={setSelected}
      toolbar={
        rows.length > pageSize || p.search === true ? (
          <>
            <TemplateSearch
              label={`Search ${title.toLowerCase()}`}
              value={query}
              onChange={(v) => {
                setQuery(v)
                setPage(1)
              }}
            />
            <span className="aiui-tpl-grow" />
            <span className="aiui-tpl-meta">{filtered.length} shown</span>
          </>
        ) : undefined
      }
      empty={<span>{q ? `Nothing matches “${query}”.` : str(p.empty, 'Nothing here yet.')}</span>}
      detailTitle={current && first ? display(current.values[first]) : undefined}
      detail={current ? <Facts items={facts} /> : undefined}
      footer={filtered.length > pageSize ? <ListPagination page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} /> : undefined}
    />
  )
}

export { Facts, TemplateSearch }
export default ListDetail
