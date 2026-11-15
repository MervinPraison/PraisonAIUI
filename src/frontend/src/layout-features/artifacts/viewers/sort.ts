/** Table sorting for the Table viewer (pure). */
import { plainText } from '../derive'

export type SortDir = 'asc' | 'desc'
export interface SortState {
  col: number
  dir: SortDir
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const NUMBER = /^[-+]?[$€£¥]?\s*\d[\d,]*(\.\d+)?\s*(%|[kKmMbB])?$/

function numeric(s: string): number | null {
  const t = s.trim()
  if (!NUMBER.test(t)) return null
  const n = Number(t.replace(/[$€£¥,%\s]/g, '').replace(/[kKmMbB]$/, ''))
  if (!Number.isFinite(n)) return null
  const unit = /[kK]$/.test(t) ? 1e3 : /[mM]$/.test(t) ? 1e6 : /[bB]$/.test(t) ? 1e9 : 1
  return n * unit
}

/** Compare two cells: numbers as numbers, otherwise natural text order; empty cells last. */
export function compareCells(a: string, b: string): number {
  const x = plainText(a)
  const y = plainText(b)
  if (!x || !y) return x ? -1 : y ? 1 : 0
  const nx = numeric(x)
  const ny = numeric(y)
  if (nx !== null && ny !== null) return nx - ny
  return collator.compare(x, y)
}

/** Rows sorted by `state` (stable); the original order when `state` is null. */
export function sortRows(rows: readonly string[][], state: SortState | null): string[][] {
  if (!state) return [...rows]
  const sign = state.dir === 'asc' ? 1 : -1
  return rows
    .map((r, i) => ({ r, i }))
    .sort((p, q) => {
      const c = compareCells(p.r[state.col] ?? '', q.r[state.col] ?? '')
      // Empty cells stay last in both directions.
      const empty = !plainText(p.r[state.col] ?? '') || !plainText(q.r[state.col] ?? '')
      return (empty ? c : sign * c) || p.i - q.i
    })
    .map(({ r }) => r)
}

/** Click on a header: ascending, then descending, then the original order. */
export function nextSort(state: SortState | null, col: number): SortState | null {
  if (!state || state.col !== col) return { col, dir: 'asc' }
  return state.dir === 'asc' ? { col, dir: 'desc' } : null
}

/** The line under the table: `Sorted by Algorithm, A to Z.` */
export function sortSummary(state: SortState | null, header: readonly string[], rows: readonly string[][]): string {
  if (!state) return 'In the order the agent wrote. Select a column header to sort.'
  const name = plainText(header[state.col] ?? '')
  const isNum = rows.length > 0 && rows.every((r) => !plainText(r[state.col] ?? '') || numeric(plainText(r[state.col] ?? '')) !== null)
  const order = isNum ? (state.dir === 'asc' ? 'smallest first' : 'largest first') : state.dir === 'asc' ? 'A to Z' : 'Z to A'
  return `Sorted by ${name}, ${order}. Select a column header to sort.`
}
