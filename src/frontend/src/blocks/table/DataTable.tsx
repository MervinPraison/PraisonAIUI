/**
 * The `table` block (praisonaiui/ui.py `table()`): typed cells, header
 * sorting, a search box, paging, a sticky header, row links and a row side
 * panel (the row's fields, or its `row_details` blocks). Every option
 * is optional: a plain `{headers, rows}` dict renders as before, plus
 * sorting. Pure logic lives in ./model.ts. Text is always rendered as text.
 */
import { useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronLeft, ChevronRight, ChevronsUpDown, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Pagination, PaginationContent, PaginationItem } from '@/components/ui/pagination'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { pageRange } from '@/components/page/model'
import { cn } from '@/lib/utils'
import type { ShellPage } from '@/sdk/manifest'
import type { BlockNode } from '@/sdk/registry'
import { BlockList } from '../BlockRenderer'
import { useInFrame } from '../context'
import { Sparkline, sparkValues } from '../chart/spark'
import { hrefLinkOnClick, pageLinkProps, tryNavigateHref } from '../mediaModel'
import { arr, display, isRecord, num, safeUrl, str, toBlockNodes } from '../normalize'
import { cellsOf, cellText, filterIndexes, inferColumns, nextSort, pageSizeOf, sortIndexes, sortValue, toColumns, toneClass, typeOf, type Column, type SortDir } from './model'

const AUTO: Column = { key: '', label: '', type: 'auto', format: '', tones: {}, align: 'left', sortable: false }
const colOf = (cols: readonly Column[], i: number): Column => cols[i] ?? AUTO
const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' } as const
const NOWRAP = new Set(['number', 'date', 'badge', 'progress', 'image', 'sparkline'])
const HEAD = 'sticky top-0 z-10 h-9 border-b border-border bg-background px-3 text-xs font-medium whitespace-nowrap text-muted-foreground'

/** One cell's content by its column type. */
export function Cell({ value, col }: { value: unknown; col: Column }): ReactNode {
  if (value === null || value === undefined || value === '') return null
  const rec = isRecord(value) ? value : null
  const type = typeOf(col, value)
  if (type === 'link') {
    const page = rec ? str(rec.page) : ''
    if (page) {
      const attrs = pageLinkProps(page, isRecord(rec?.params) ? rec.params : undefined)
      const text = str(rec?.text ?? rec?.label, attrs.href)
      return (
        <a {...attrs} className="font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline">
          {text}
        </a>
      )
    }
    const href = safeUrl(rec ? rec.href : value)
    const text = rec ? str(rec.text ?? rec.label, href ?? '') : display(value)
    if (!href) return text
    const external = rec?.external === true
    return (
      <a
        href={href}
        target={external ? '_blank' : undefined}
        rel={external ? 'noopener noreferrer' : undefined}
        onClick={external ? undefined : hrefLinkOnClick(href)}
        className="font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline"
      >
        {text}
      </a>
    )
  }
  if (type === 'badge' || type === 'tag') {
    const items = Array.isArray(value) ? value : type === 'tag' && typeof value === 'string' ? value.split(',') : [value]
    return (
      <span className="inline-flex flex-wrap gap-1">
        {items.map((it, i) => {
          const r = isRecord(it) ? it : null
          const text = (r ? str(r.text ?? r.label) : display(it)).trim()
          const cls = toneClass(r ? str(r.tone) : str(col.tones[text]))
          return text ? <Badge key={i} variant={cls ? 'outline' : 'secondary'} className={cls}>{text}</Badge> : null
        })}
      </span>
    )
  }
  if (type === 'image') {
    const src = safeUrl(rec ? rec.src : value, 'image')
    const size = col.format === 'wide' ? 'h-9 w-16' : 'size-9'
    return src ? <img src={src} alt={str(rec?.alt, col.label)} loading="lazy" decoding="async" className={cn('rounded-md bg-muted object-cover', size)} /> : null
  }
  if (type === 'sparkline') {
    const values = sparkValues(value)
    return values.length ? <span className="block w-24"><Sparkline values={values} height={20} fill={false} label={`${col.label}: ${cellText(value, col)}`} /></span> : null
  }
  if (type === 'progress') {
    const n = Math.min(1, Math.max(0, num(rec ? rec.value : value, 0)))
    const label = cellText(n, col)
    return (
      <span className="inline-flex items-center gap-2">
        {/* Same bar as the progress block: no extra primitive in the chunk graph. */}
        <span role="progressbar" aria-label={`${col.label} ${label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(n * 100)} className="block h-1.5 w-16 overflow-hidden rounded-full bg-secondary sm:w-20">
          <span className="block h-full rounded-full bg-primary" style={{ width: `${n * 100}%` }} />
        </span>
        <span className="text-xs text-muted-foreground">{label}</span>
      </span>
    )
  }
  return cellText(value, col)
}

function SortIcon({ dir }: { dir?: SortDir }) {
  const Icon = dir === 'asc' ? ArrowUpNarrowWide : dir === 'desc' ? ArrowDownWideNarrow : ChevronsUpDown
  return <Icon aria-hidden className={cn('size-3 shrink-0', !dir && 'opacity-50')} />
}

/** The side panel's body: the row's `row_details` blocks, else its fields. */
export function RowDetail({ cells, columns, blocks, page }: { cells: readonly unknown[]; columns: readonly Column[]; blocks: BlockNode[]; page?: ShellPage }) {
  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 pb-4">
      {blocks.length > 0 ? (
        <BlockList nodes={blocks} page={page} />
      ) : (
        <dl className="divide-y divide-border text-sm">
          {cells.map((v, i) => (
            <div key={i} className="flex items-baseline justify-between gap-4 py-2">
              <dt className="shrink-0 text-muted-foreground">{colOf(columns, i).label || `Column ${i + 1}`}</dt>
              <dd className="min-w-0 text-right break-words text-foreground"><Cell value={v} col={colOf(columns, i)} /></dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

export function TableBlock({ node, page }: { node: BlockNode; page?: ShellPage }) {
  const p = node.props ?? {}
  const nested = useInFrame()
  const rows = arr(p.rows)
  const base = useMemo(() => toColumns(p.columns, p.headers, p.sortable !== false), [p.columns, p.headers, p.sortable])
  const cells = useMemo(() => rows.map((r) => cellsOf(r, base)), [rows, base])
  const columns = useMemo(() => inferColumns(base, cells), [base, cells])
  const texts = useMemo(() => cells.map((cs) => cs.map((v, i) => cellText(v, colOf(columns, i))).join(' ').toLowerCase()), [cells, columns])

  const sameLength = (v: unknown) => Array.isArray(v) && v.length === rows.length
  const rowIds = sameLength(p.row_ids) ? arr(p.row_ids).map((x) => str(x)) : null
  const actions = rowIds ? arr(p.actions).map((a) => str(a)).filter(Boolean) : []
  const hrefs = sameLength(p.row_hrefs) ? arr(p.row_hrefs).map((h) => safeUrl(h)) : null
  const details = sameLength(p.row_details) ? arr(p.row_details) : null
  const hasDetail = p.row_detail === true || details !== null
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

  // Same bubbling DOM events as the legacy table (#336).
  const emit = (el: HTMLElement, name: string, detail: Record<string, unknown>) => el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }))
  const activate = (el: HTMLElement, index: number, e?: MouseEvent) => {
    const rowId = rowIds?.[index]
    if (rowId !== undefined) {
      setSelected(rowId)
      emit(el, 'aiui:table-select', { rowId, index })
    }
    if (hasDetail) {
      opener.current = el
      setOpen(index)
    } else if (rowId === undefined && hrefs?.[index]) {
      const href = hrefs[index] as string
      if (e?.metaKey || e?.ctrlKey) window.open(href, '_blank', 'noopener')
      else if (!tryNavigateHref(href)) window.location.assign(href)
    }
  }
  const turn = (n: number) => (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={n < 0 ? 'Previous page' : 'Next page'} disabled={n < 0 ? current <= 1 : current >= pages} onClick={() => setPageNo(current + n)}>
      {n < 0 ? <ChevronLeft aria-hidden /> : <ChevronRight aria-hidden />}
    </Button>
  )

  if (rows.length === 0 && columns.length === 0) return null
  const focusable = (rowId: string | undefined) => rowId !== undefined || hasDetail
  const openCells = open === null ? null : cells[open]
  const openBlocks = open !== null && details ? toBlockNodes(arr(details[open])) : []
  return (
    <div data-nested={nested || undefined} className={cn('flex min-w-0 flex-col', !nested && 'rounded-xl border border-border')}>
      {p.searchable === true && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={query} placeholder="Search" aria-label={caption ? `Search ${caption}` : 'Search table'} className="h-8 pl-8" onChange={(e) => (setQuery(e.target.value), setPageNo(1))} />
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
                  const ariaSort = !c.sortable ? undefined : dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'
                  return (
                    <th key={i} scope="col" aria-sort={ariaSort} style={c.width ? { width: c.width, minWidth: c.width } : undefined} className={cn(HEAD, ALIGN[c.align])}>
                      {c.sortable ? (
                        <button type="button" onClick={() => (setSort(nextSort(sort, i)), setPageNo(1))} className={cn('inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', c.align === 'right' && 'flex-row-reverse', dir && 'text-foreground')}
                        >
                          {c.label}
                          <SortIcon dir={dir} />
                        </button>
                      ) : c.label}
                    </th>
                  )
                })}
                {actions.length > 0 && (
                  <th scope="col" className={HEAD}>
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
          )}
          <tbody className="[&>tr:last-child>td]:border-b-0">
            {visible.length === 0 && query.trim() !== '' && (
              <tr>
                <td colSpan={Math.max(1, columns.length + (actions.length ? 1 : 0))} className="px-3 py-6 text-center text-muted-foreground">
                  Nothing matches “{query.trim()}”.
                </td>
              </tr>
            )}
            {visible.map((index) => {
              const row = cells[index]
              const rowId = rowIds?.[index]
              const href = hrefs?.[index]
              const isSelected = rowId !== undefined && rowId === selected
              return (
                <tr
                  key={rowId ?? index}
                  data-row-id={rowId}
                  aria-selected={rowId !== undefined ? isSelected : undefined}
                  tabIndex={focusable(rowId) ? 0 : undefined}
                  onClick={
                    focusable(rowId) || href
                      ? (e) => {
                          // Links, buttons and inputs inside the row handle their own click.
                          if (!(e.target as HTMLElement).closest('a,button,input,select,textarea')) activate(e.currentTarget, index, e)
                        }
                      : undefined
                  }
                  onKeyDown={(e) => {
                    if (!focusable(rowId) || e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
                    e.preventDefault()
                    activate(e.currentTarget, index)
                  }}
                  className={cn(
                    (focusable(rowId) || href) && 'cursor-pointer outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                    isSelected && 'bg-accent text-accent-foreground hover:bg-accent',
                  )}
                >
                  {row.map((cell, i) => {
                    const c = colOf(columns, i)
                    const content = <Cell value={cell} col={c} />
                    return (
                      <td key={i} className={cn('border-b border-border px-3 py-2 align-middle text-foreground', ALIGN[c.align], NOWRAP.has(c.type) && 'whitespace-nowrap')}>
                        {/* A row link: its first cell is the link the keyboard reaches. */}
                        {i === 0 && href && typeOf(c, cell) !== 'link' ? <a href={href} className="font-medium outline-none hover:underline focus-visible:underline">{content}</a> : content}
                      </td>
                    )
                  })}
                  {actions.length > 0 && (
                    <td className="border-b border-border px-3 py-1 text-right whitespace-nowrap">
                      <div className="inline-flex gap-1">
                        {actions.map((action) => (
                          <Button key={action} type="button" size="xs" variant="ghost" aria-label={`${action} ${cellText(row[0] ?? rowId, colOf(columns, 0))}`} onClick={(e) => (e.stopPropagation(), emit(e.currentTarget, 'aiui:table-action', { action, rowId }))}>
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
          <span>{`${from}–${to} of ${order.length}`}</span>
          <PaginationContent>
            <PaginationItem>{turn(-1)}</PaginationItem>
            <PaginationItem>{`${current} / ${pages}`}</PaginationItem>
            <PaginationItem>{turn(1)}</PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
      {hasDetail && (
        <Sheet open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
          {/* Focus goes back to the row that opened the panel. */}
          <SheetContent className="w-full overflow-y-auto sm:max-w-md" onCloseAutoFocus={(e) => (e.preventDefault(), opener.current?.focus())}>
            <SheetHeader className="pr-10">
              <SheetTitle className="break-words">{(openCells && cellText(openCells[0], colOf(columns, 0))) || 'Details'}</SheetTitle>
              <SheetDescription className="sr-only">{caption ? `Row details, ${caption}` : 'Row details'}</SheetDescription>
            </SheetHeader>
            <RowDetail cells={openCells ?? []} columns={columns} blocks={openBlocks} page={page} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
