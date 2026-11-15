/**
 * The `list_detail` block: block props to the ListDetail template. Registered
 * lazily by blocks/coreBlocks.tsx, in its own chunk. The template does not
 * depend on the block layer, so a React page uses it without the blocks chunk.
 */
import { useMemo, useState } from 'react'
import { arr, display, isRecord, num, str } from '@/blocks/normalize'
import type { BlockNode } from '@/sdk/registry'
import { ListDetail, ListPagination, type ListColumn } from '../ListDetail'
import { pageRange } from '../model'
import { Facts, TemplateSearch } from '../parts'

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
            {/* The pager says how many there are; this says what the search kept. */}
            {q && (
              <span className="aiui-tpl-meta" role="status">
                {filtered.length} of {rows.length} match
              </span>
            )}
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
