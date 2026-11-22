/**
 * The `table` block (praisonaiui/ui.py `table()`): typed cells (number, link,
 * badge, tag, image, progress, date), header sorting, a search box, paging,
 * a sticky header, row links and a row detail drawer. Every option is
 * optional: a plain `{headers, rows}` dict renders as before, plus sorting.
 * Pure logic lives in ./model.ts. Text is always rendered as text.
 */
import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronLeft, ChevronRight, ChevronsUpDown, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination'
import { Progress } from '@/components/ui/progress'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { pageRange } from '@/components/page/model'
import { cn } from '@/lib/utils'
import type { ShellPage } from '@/sdk/manifest'
import type { BlockNode } from '@/sdk/registry'
import { BlockList } from '../BlockRenderer'
import { useInFrame } from '../context'
import { arr, display, isRecord, num, safeUrl, str, toBlockNodes } from '../normalize'
import {
  cellsOf,
  cellText,
  filterIndexes,
  inferColumns,
  nextSort,
  pageSizeOf,
  sortIndexes,
  sortValue,
  toColumns,
  toneClass,
  typeOf,
  type Column,
  type SortDir,
} from './model'

const AUTO: Column = { key: '', label: '', type: 'auto', format: '', tones: {}, align: 'left', sortable: false }
const colOf = (cols: readonly Column[], i: number): Column => cols[i] ?? AUTO
const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const

function TagBadge({ text, tone }: { text: string; tone?: string }) {
  const cls = toneClass(str(tone))
  return (
    <Badge variant={cls ? 'outline' : 'secondary'} className={cls}>
      {text}
    </Badge>
  )
}

/** One cell's content by its column type. */
export function Cell({ value, col }: { value: unknown; col: Column }): ReactNode {
  const type = typeOf(col, value)
  const rec = isRecord(value) ? value : null
  if (value === null || value === undefined || value === '') return null
  switch (type) {
    case 'link': {
      const href = safeUrl(rec ? rec.href : value)
      const text = rec ? str(rec.text ?? rec.label, href ?? '') : display(value)
      if (!href) return text
      const external = rec?.external === true
      return (
        <a
          href={href}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
          className="font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline"
        >
          {text}
        </a>
      )
    }
    case 'badge':
    case 'tag': {
      const items = Array.isArray(value) ? value : type === 'tag' && typeof value === 'string' ? value.split(',') : [value]
      return (
        <span className="inline-flex flex-wrap gap-1">
          {items.map((it, i) => {
            const r = isRecord(it) ? it : null
            const text = (r ? str(r.text ?? r.label) : display(it)).trim()
            return text ? <TagBadge key={i} text={text} tone={r ? str(r.tone) : col.tones[text]} /> : null
          })}
        </span>
      )
    }
    case 'image': {
      const src = safeUrl(rec ? rec.src : value, 'image')
      if (!src) return null
      return (
        <img
          src={src}
          alt={str(rec?.alt, col.label)}
          loading="lazy"
          decoding="async"
          className={cn('rounded-md bg-muted object-cover', col.format === 'wide' ? 'h-9 w-16' : 'size-9')}
        />
      )
    }
    case 'progress': {
      const n = Math.min(1, Math.max(0, num(rec ? rec.value : value, 0)))
      const label = cellText(n, col)
      return (
        <span className="inline-flex items-center gap-2">
          <Progress value={n * 100} aria-label={`${col.label} ${label}`} className="h-1.5 w-16 sm:w-20" />
          <span className="text-xs text-muted-foreground">{label}</span>
        </span>
      )
    }
    default:
      return cellText(value, col)
  }
}

function SortIcon({ dir }: { dir?: SortDir }) {
  const Icon = dir === 'asc' ? ArrowUpNarrowWide : dir === 'desc' ? ArrowDownWideNarrow : ChevronsUpDown
  return <Icon aria-hidden className={cn('size-3 shrink-0', !dir && 'opacity-50')} />
}

const nowrap = (c: Column) => ['number', 'date', 'badge', 'progress', 'image'].includes(c.type)

export function TableBlock({ node, page }: { node: BlockNode; page?: ShellPage }) {
  const p = node.props ?? {}
  const nested = useInFrame()
  const rows = arr(p.rows)
  const base = useMemo(() => toColumns(p.columns, p.headers, p.sortable !== false), [p.columns, p.headers, p.sortable])
  const cells = useMemo(() => rows.map((r) => cellsOf(r, base)), [rows, base])
  const columns = useMemo(() => inferColumns(base, cells), [base, cells])
  const colAt = (i: number) => colOf(columns, i)
  const texts = useMemo(() => cells.map((cs) => cs.map((v, i) => cellText(v, colOf(columns, i))).join(' ').toLowerCase()), [cells, columns])

  const sameLength = (v: unknown) => Array.isArray(v) && v.length === rows.length
  const rowIds = sameLength(p.row_ids) ? arr(p.row_ids).map((x) => str(x)) : null
  const actions = rowIds ? arr(p.actions).map((a) => str(a)).filter(Boolean) : []
  const hrefs = sameLength(p.row_hrefs) ? arr(p.row_hrefs).map((h) => safeUrl(h)) : null
  const details = sameLength(p.row_details) ? arr(p.row_details) : null
  const hasDetail = p.row_detail === true || details !== null
  const searchable = p.searchable === true
  const caption = str(p.caption ?? p.title)
  const maxHeight = p.max_height === 0 ? undefined : typeof p.max_height === 'number' ? `${p.max_height}px` : str(p.max_height, '70vh')

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ col: number; dir: SortDir } | null>(null)
  const [pageNo, setPageNo] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const opener = useRef<HTMLElement | null>(null)

  const sortValues = useMemo(() => (sort ? cells.map((cs) => sortValue(cs[sort.col], colOf(columns, sort.col))) : null), [cells, columns, sort])
  const order = useMemo(() => {
    const kept = filterIndexes(texts, query)
    return sort && sortValues ? sortIndexes(sortValues, sort.dir, kept) : kept
  }, [texts, query, sort, sortValues])

  const pageSize = pageSizeOf(p.page_size, rows.length)
  const { from, to, pages } = pageRange(pageNo, pageSize || 1, order.length)
  const current = Math.min(pageNo, pages)
  const visible = pageSize ? order.slice(Math.max(0, from - 1), to) : order

  const emit = (el: HTMLElement, name: string, detail: Record<string, unknown>) =>
    el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }))

  const activate = (el: HTMLElement, index: number, e?: MouseEvent) => {
    const rowId = rowIds?.[index]
    if (rowId !== undefined) {
      setSelected(rowId)
      emit(el, 'aiui:table-select', { rowId, index })
    }
    if (hasDetail) {
      opener.current = el
      setOpen(index)
    } else if (hrefs?.[index] && !rowIds) {
      const href = hrefs[index] as string
      if (e && (e.metaKey || e.ctrlKey)) window.open(href, '_blank', 'noopener')
      else window.location.assign(href)
    }
  }

  if (rows.length === 0 && columns.length === 0) return null
  const interactive = rowIds !== null || hasDetail
  const width = columns.length + (actions.length ? 1 : 0)
  const openCells = open === null ? null : cells[open]
  const openBlocks = open === null || !details ? [] : toBlockNodes(arr(details[open]))

  return (
    <div data-nested={nested || undefined} className={cn('flex min-w-0 flex-col', !nested && 'rounded-xl border border-border')}>
      {searchable && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              placeholder="Search"
              aria-label={caption ? `Search ${caption}` : 'Search table'}
              className="h-8 pl-8"
              onChange={(e) => {
                setQuery(e.target.value)
                setPageNo(1)
              }}
            />
          </div>
          <span role="status" className="text-xs text-muted-foreground tabular-nums">
            {query.trim() ? `${order.length} of ${rows.length}` : `${rows.length} rows`}
          </span>
        </div>
      )}
      <div className="min-w-0 overflow-auto" style={{ maxHeight }}>
        <table className="w-full border-separate border-spacing-0 text-sm tabular-nums">
          {caption && <caption className="sr-only">{caption}</caption>}
          {columns.length > 0 && (
            <thead>
              <tr>
                {columns.map((c, i) => {
                  const dir = sort?.col === i ? sort.dir : undefined
                  return (
                    <th
                      key={i}
                      scope="col"
                      aria-sort={c.sortable ? (dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none') : undefined}
                      style={c.width ? { width: c.width, minWidth: c.width } : undefined}
                      className={cn(
                        'sticky top-0 z-10 h-9 border-b border-border bg-background px-3 text-xs font-medium whitespace-nowrap text-muted-foreground',
                        ALIGN[c.align],
                      )}
                    >
                      {c.sortable ? (
                        <button
                          type="button"
                          onClick={() => {
                            setSort(nextSort(sort, i))
                            setPageNo(1)
                          }}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                            c.align === 'right' && 'flex-row-reverse',
                            dir && 'text-foreground',
                          )}
                        >
                          {c.label}
                          <SortIcon dir={dir} />
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                  )
                })}
                {actions.length > 0 && (
                  <th scope="col" className="sticky top-0 z-10 h-9 border-b border-border bg-background px-3">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
          )}
          <tbody className="[&>tr:last-child>td]:border-b-0">
            {visible.length === 0 && query.trim() !== '' && (
              <tr>
                <td colSpan={Math.max(1, width)} className="px-3 py-6 text-center text-muted-foreground">
                  Nothing matches “{query.trim()}”.
                </td>
              </tr>
            )}
            {visible.map((index) => {
              const row = cells[index]
              const rowId = rowIds?.[index]
              const href = hrefs?.[index]
              const isSelected = rowId !== undefined && rowId === selected
              const clickable = interactive || !!href
              return (
                <tr
                  key={rowId ?? index}
                  data-row-id={rowId}
                  aria-selected={rowId !== undefined ? isSelected : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  onClick={
                    clickable
                      ? (e) => {
                          // Links, buttons and inputs inside the row handle their own click.
                          if ((e.target as HTMLElement).closest('a,button,input,select,textarea')) return
                          activate(e.currentTarget, index, e)
                        }
                      : undefined
                  }
                  onKeyDown={
                    interactive
                      ? (e: KeyboardEvent<HTMLTableRowElement>) => {
                          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault()
                            activate(e.currentTarget, index)
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    clickable && 'cursor-pointer outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                    isSelected && 'bg-accent text-accent-foreground hover:bg-accent',
                  )}
                >
                  {row.map((cell, i) => {
                    const c = colAt(i)
                    const content = <Cell value={cell} col={c} />
                    return (
                      <td
                        key={i}
                        className={cn('border-b border-border px-3 py-2 align-middle text-foreground', ALIGN[c.align], nowrap(c) && 'whitespace-nowrap')}
                      >
                        {i === 0 && href && typeOf(c, cell) !== 'link' ? (
                          <a href={href} className="font-medium outline-none hover:underline focus-visible:underline">
                            {content}
                          </a>
                        ) : (
                          content
                        )}
                      </td>
                    )
                  })}
                  {actions.length > 0 && (
                    <td className="border-b border-border px-3 py-1 text-right whitespace-nowrap">
                      <div className="inline-flex gap-1">
                        {actions.map((action) => (
                          <Button
                            key={action}
                            type="button"
                            size="xs"
                            variant="ghost"
                            aria-label={`${action} ${cellText(row[0] ?? rowId, colAt(0))}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              emit(e.currentTarget, 'aiui:table-action', { action, rowId })
                            }}
                          >
                            {action}
                          </Button>
                        ))}
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {pageSize > 0 && order.length > pageSize && (
        <Pagination aria-label="Table pages" className="items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-xs text-muted-foreground tabular-nums">
          <span>
            {from}–{to} of {order.length}
          </span>
          <PaginationContent>
            <PaginationItem>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Previous page" disabled={current <= 1} onClick={() => setPageNo(current - 1)}>
                <ChevronLeft aria-hidden />
              </Button>
            </PaginationItem>
            <PaginationItem>
              <span>
                {current} / {pages}
              </span>
            </PaginationItem>
            <PaginationItem>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Next page" disabled={current >= pages} onClick={() => setPageNo(current + 1)}>
                <ChevronRight aria-hidden />
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
      {hasDetail && (
        <Sheet open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
          <SheetContent
            className="w-full overflow-y-auto sm:max-w-md"
            onCloseAutoFocus={(e) => {
              e.preventDefault()
              opener.current?.focus()
            }}
          >
            <SheetHeader className="pr-10">
              <SheetTitle>{openCells ? cellText(openCells[0], colAt(0)) || 'Details' : 'Details'}</SheetTitle>
              <SheetDescription className="sr-only">Row details</SheetDescription>
            </SheetHeader>
            <div className="flex min-w-0 flex-col gap-4 px-4 pb-4">
              {openBlocks.length > 0 ? (
                <BlockList nodes={openBlocks} page={page} />
              ) : (
                openCells && (
                  <dl className="divide-y divide-border">
                    {openCells.map((v, i) => (
                      <div key={i} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                        <dt className="text-muted-foreground">{colAt(i).label || `Column ${i + 1}`}</dt>
                        <dd className="min-w-0 text-right break-words text-foreground">
                          <Cell value={v} col={colAt(i)} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                )
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
