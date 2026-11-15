/**
 * A table artifact: sortable by any column (header buttons with aria-sort),
 * the first column as row headers, numbers sorted as numbers.
 */
import { useMemo, useState, type JSX } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { parseTable, plainText } from '../derive'
import { nextSort, sortRows, sortSummary, type SortState } from './sort'

const YES = /^(yes|true|✓|✔|✅)$/i
const NO = /^(no|false|✗|✘|❌)$/i

function Cell({ md }: { md: string }): JSX.Element {
  const text = plainText(md)
  if (YES.test(text)) {
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-success">
        <Check className="size-3.5" strokeWidth={2.25} aria-hidden />
        {/^(yes|no|true|false)$/i.test(text) ? text : 'Yes'}
      </span>
    )
  }
  if (NO.test(text)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-tier-2">
        <X className="size-3.5" strokeWidth={2.25} aria-hidden />
        {/^(yes|no|true|false)$/i.test(text) ? text : 'No'}
      </span>
    )
  }
  const code = /^`[^`]+`$/.test(md.trim())
  return <span className={cn(code && 'font-mono text-xs whitespace-nowrap')}>{text}</span>
}

export default function TableViewer({ content, label }: { content: string; label: string }): JSX.Element {
  const { header, rows } = useMemo(() => parseTable(content), [content])
  const [sort, setSort] = useState<SortState | null>(null)
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort])
  if (!header.length) return <p className="text-sm text-tier-3">This table is empty.</p>
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="overflow-x-auto rounded-lg border border-hairline">
        <table className="w-full border-collapse text-base tabular-nums" aria-label={label}>
          <thead>
            <tr className="bg-sidebar">
              {header.map((h, c) => {
                const active = sort?.col === c
                const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown
                return (
                  <th
                    key={c}
                    scope="col"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className="border-b border-hairline p-0 text-left"
                  >
                    <button
                      type="button"
                      onClick={() => setSort((s) => nextSort(s, c))}
                      className={cn(
                        'flex w-full items-center gap-1.5 px-3.5 py-2 text-left text-sm font-semibold outline-none hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring',
                        active ? 'text-foreground' : 'text-tier-2',
                      )}
                    >
                      {plainText(h)}
                      <Icon className={cn('size-3.5', active ? 'text-link' : 'text-tier-3')} aria-hidden />
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={i} className="border-b border-hairline last:border-b-0">
                {r.map((cell, c) =>
                  c === 0 ? (
                    <th key={c} scope="row" className="px-3.5 py-2.5 text-left font-medium">
                      <Cell md={cell} />
                    </th>
                  ) : (
                    <td key={c} className="px-3.5 py-2.5">
                      <Cell md={cell} />
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-tier-3" aria-live="polite">
        {sortSummary(sort, header, rows)}
      </p>
    </div>
  )
}
