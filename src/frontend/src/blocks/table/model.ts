/**
 * Pure logic of the `table` block (DataTable.tsx): column config, cell
 * formatting, numeric-aware stable sorting, search and the default page size.
 * No React and no DOM, so it is unit tested directly.
 */
import { arr, display, isRecord, num, str } from '../normalize'

export type ColumnType = 'auto' | 'text' | 'number' | 'link' | 'badge' | 'tag' | 'image' | 'progress' | 'date'
export type Align = 'left' | 'center' | 'right'

export interface Column {
  key: string
  label: string
  type: ColumnType
  /** number: compact | percent | multiplier (x) | fixed; date: date | datetime | iso. */
  format: string
  /** Fraction digits for numbers (fixed, percent, multiplier, default). */
  decimals?: number
  /** badge/tag: cell value → tone (success, warning, error, info, neutral). */
  tones: Record<string, string>
  width?: string
  align: Align
  /** True when the server set `align` (inference leaves it alone). */
  alignSet?: boolean
  sortable: boolean
}

const TYPES = new Set<ColumnType>(['auto', 'text', 'number', 'link', 'badge', 'tag', 'image', 'progress', 'date'])
const ALIGNS = new Set<Align>(['left', 'center', 'right'])

function alignOf(v: unknown, type: ColumnType): Align {
  const s = str(v)
  if (s === 'end') return 'right'
  if (ALIGNS.has(s as Align)) return s as Align
  return type === 'number' ? 'right' : 'left'
}

/** `columns` (strings or dicts) or, without them, `headers` → column config. */
export function toColumns(columns: unknown, headers: unknown, sortable = true): Column[] {
  const spec = arr(columns).length ? arr(columns) : arr(headers)
  return spec.map((c) => {
    const rec = isRecord(c) ? c : { key: display(c) }
    const key = str(rec.key ?? rec.label)
    const t = str(rec.type, 'auto') as ColumnType
    const type = TYPES.has(t) ? t : 'auto'
    const width = typeof rec.width === 'number' ? `${rec.width}px` : str(rec.width) || undefined
    return {
      key,
      label: str(rec.label, key),
      type,
      format: str(rec.format),
      decimals: rec.decimals === undefined ? undefined : Math.min(10, Math.max(0, num(rec.decimals, 0))),
      tones: isRecord(rec.tones) ? Object.fromEntries(Object.entries(rec.tones).map(([k, v]) => [k, str(v)])) : {},
      width,
      align: alignOf(rec.align, type),
      alignSet: rec.align !== undefined,
      sortable: sortable && rec.sortable !== false && type !== 'image',
    }
  })
}

/** An `auto` column whose values are all numbers lines up at the end. */
export function inferColumns(columns: readonly Column[], rows: readonly unknown[][]): Column[] {
  return columns.map((c, i) => {
    if (c.type !== 'auto' || c.alignSet) return c
    let seen = false
    for (const r of rows) {
      const v = r[i]
      if (v === null || v === undefined || v === '') continue
      if (typeof v !== 'number') return c
      seen = true
    }
    return seen ? { ...c, align: 'right' } : c
  })
}

/** One row (array in column order, or a dict keyed by column key) → its cells. */
export function cellsOf(row: unknown, columns: readonly Column[]): unknown[] {
  if (Array.isArray(row)) return row
  if (isRecord(row)) return columns.map((c) => row[c.key])
  return [row]
}

/** A cell's resolved type: `auto` looks at the value. */
export function typeOf(col: Column, v: unknown): ColumnType {
  if (col.type !== 'auto') return col.type
  if (typeof v === 'number') return 'number'
  if (isRecord(v)) return 'href' in v ? 'link' : 'src' in v ? 'image' : 'text'
  return 'text'
}

/** The text a cell shows (also what search matches). */
export function cellText(v: unknown, col: Column): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map((x) => cellText(x, col)).join(', ')
  if (isRecord(v)) {
    const t = v.text ?? v.label ?? v.alt ?? v.value ?? v.href
    return t === undefined ? display(v) : str(t)
  }
  // `auto` numbers show as sent (a year stays 2024); `number` columns format.
  if (col.type === 'number') return formatNumber(v, col.format, col.decimals)
  if (col.type === 'date') return formatDate(v, col.format)
  if (col.type === 'progress') return formatNumber(v, 'percent', col.decimals ?? 0)
  return display(v)
}

// ── numbers ──────────────────────────────────────────────────────────

const nf = (min: number, max: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max })

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

/**
 * `compact` 1234 → 1.2k, 3_400_000 → 3.4M; `percent` 0.123 → 12.3% (a
 * fraction); `multiplier` or `x` 2.345 → 2.3x; `fixed` → exactly `decimals`
 * (default 2); anything else → grouped digits. Non-numbers show as text.
 */
export function formatNumber(v: unknown, format = '', decimals?: number): string {
  const n = toNumber(v)
  if (n === null) return display(v)
  switch (format) {
    case 'compact': {
      const units: [number, string][] = [
        [1e12, 'T'],
        [1e9, 'B'],
        [1e6, 'M'],
        [1e3, 'k'],
      ]
      const d = decimals ?? 1
      for (let i = 0; i < units.length; i++) {
        const [size, unit] = units[i]
        if (Math.abs(n) < size) continue
        const scaled = Number((n / size).toFixed(d))
        // 999,950 rounds to 1000k: show 1M instead.
        if (Math.abs(scaled) >= 1000 && i > 0) return `${nf(0, d).format(Number((n / units[i - 1][0]).toFixed(d)))}${units[i - 1][1]}`
        return `${nf(0, d).format(scaled)}${unit}`
      }
      return nf(0, decimals ?? 1).format(n)
    }
    case 'percent':
      return `${nf(0, decimals ?? 1).format(n * 100)}%`
    case 'multiplier':
    case 'x':
      return `${nf(0, decimals ?? 1).format(n)}x`
    case 'fixed':
      return nf(decimals ?? 2, decimals ?? 2).format(n)
    default:
      return decimals === undefined ? nf(0, 2).format(n) : nf(decimals, decimals).format(n)
  }
}

// ── dates ────────────────────────────────────────────────────────────

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/** A date cell → epoch ms, or null. Numbers below 1e11 are seconds. */
export function toTime(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v
  if (typeof v !== 'string' || !v.trim()) return null
  const t = Date.parse(DATE_ONLY.test(v.trim()) ? `${v.trim()}T00:00:00Z` : v)
  return Number.isFinite(t) ? t : null
}

/** `date` (default) Nov 22, 2026; `datetime` adds the time; `iso` 2026-11-22. Shown in UTC. */
export function formatDate(v: unknown, format = ''): string {
  const t = toTime(v)
  if (t === null) return display(v)
  const d = new Date(t)
  if (format === 'iso') return d.toISOString().slice(0, 10)
  const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }
  if (format === 'datetime') Object.assign(opts, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return new Intl.DateTimeFormat('en-US', opts).format(d)
}

// ── sorting ──────────────────────────────────────────────────────────

export type SortValue = number | string | null
export type SortDir = 'asc' | 'desc'

/** "1,234", "$12", "1.2k", "3.4M", "12%", "2.5x" → numbers; other text lowercased. */
const NUMERIC = /^[-+]?[$€£]?\s*(\d[\d,]*\.?\d*|\.\d+)\s*([kKmMbBtT]|%|x)?$/
const SCALE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }

export function sortValue(v: unknown, col: Column): SortValue {
  if (v === null || v === undefined || v === '') return null
  if (Array.isArray(v)) return v.length ? sortValue(v[0], col) : null
  if (isRecord(v)) return sortValue(v.value ?? v.text ?? v.label ?? v.alt ?? null, col)
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (col.type === 'date') return toTime(v) ?? str(v).toLowerCase()
  const s = str(v).trim()
  const m = NUMERIC.exec(s)
  if (m) {
    const n = Number(m[1].replace(/,/g, '')) * (SCALE[(m[2] ?? '').toLowerCase()] ?? 1)
    return s.startsWith('-') ? -n : n
  }
  return s.toLowerCase()
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/** Numbers before text; empty cells always last, whichever the direction. */
export function compareValues(a: SortValue, b: SortValue, dir: SortDir = 'asc'): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  const sign = dir === 'asc' ? 1 : -1
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * sign
  if (typeof a === 'number') return -1 * sign
  if (typeof b === 'number') return 1 * sign
  return collator.compare(a, b) * sign
}

/** A stable sort of indexes: equal values keep their original order. */
export function sortIndexes(values: readonly SortValue[], dir: SortDir, order?: readonly number[]): number[] {
  const idx = order ? [...order] : values.map((_, i) => i)
  return idx.sort((i, j) => compareValues(values[i], values[j], dir) || i - j)
}

/** Header click: unsorted → ascending → descending → unsorted. */
export function nextSort(current: { col: number; dir: SortDir } | null, col: number): { col: number; dir: SortDir } | null {
  if (!current || current.col !== col) return { col, dir: 'asc' }
  return current.dir === 'asc' ? { col, dir: 'desc' } : null
}

// ── search and paging ────────────────────────────────────────────────

/** Indexes of rows whose text holds every word of the query (case-insensitive). */
export function filterIndexes(texts: readonly string[], query: string, order?: readonly number[]): number[] {
  const idx = order ?? texts.map((_, i) => i)
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [...idx]
  return idx.filter((i) => words.every((w) => texts[i].includes(w)))
}

/** `page_size`: a positive number pages; 0 or false shows every row; unset pages by 50 past 100 rows. */
export function pageSizeOf(v: unknown, total: number): number {
  if (v === 0 || v === false) return 0
  const n = num(v, 0)
  if (n > 0) return Math.floor(n)
  return total > 100 ? 50 : 0
}

const TONE_CLASS: Record<string, string> = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
  info: 'border-info/30 bg-info/10 text-info',
}

/** A badge's tone classes (`danger` is `error`); unknown tones are neutral. */
export function toneClass(tone: string): string | undefined {
  return TONE_CLASS[tone === 'danger' || tone === 'destructive' ? 'error' : tone]
}
