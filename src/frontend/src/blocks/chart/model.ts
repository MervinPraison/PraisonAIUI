/**
 * The `chart` block's data model: block props (praisonaiui/ui.py `chart()`,
 * or a hand-written dict) → a ChartSpec the renderer draws, plus the value
 * formats and histogram bins. Pure: no React, no chart library, so it is
 * unit-tested on its own and stays out of the renderer's chunk boundaries.
 */
import { arr, isRecord, num, str } from '../normalize'

export const CHART_KINDS = ['bar', 'barh', 'line', 'area', 'scatter', 'pie', 'donut', 'histogram'] as const
export type ChartKind = (typeof CHART_KINDS)[number]

export const VALUE_FORMATS = ['number', 'compact', 'percent', 'multiplier', 'duration'] as const
export type ValueFormat = (typeof VALUE_FORMATS)[number]

const KIND_ALIASES: Record<string, ChartKind> = { column: 'bar', columns: 'bar', hbar: 'barh', doughnut: 'donut' }

export type Row = Record<string, unknown>
export type Series = { key: string; label: string; color: string }
export type Reference = { value: number; label?: string }

/** `x`: category key (scatter: x value; histogram: `bin`). `y2`: faint bars on their own scale. `label`: scatter point name key. */
export interface ChartSpec {
  kind: ChartKind; title: string; caption: string; rows: Row[]; x: string; series: Series[]; y2?: Series; label?: string
  stacked: boolean; references: Reference[]; colorByReference: boolean; xFormat?: ValueFormat; yFormat?: ValueFormat
  yDomain?: [number, number]; height: number; legend: boolean
}

/** Upper bound on drawn rows: a page payload is untrusted and SVG cost grows with points. */
export const MAX_ROWS = 5000
const PALETTE_SIZE = 5

/** Series / slice colour `i` from the theme's chart tokens; past the fifth, a softer second round. */
export function seriesColor(i: number): string {
  const token = `var(--chart-${(i % PALETTE_SIZE) + 1})`
  return i < PALETTE_SIZE ? token : `color-mix(in oklab, ${token} 60%, var(--background))`
}

export const MUTED_COLOR = 'var(--muted-foreground)'

export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/** A value in one of the formats; non-numbers as text. */
export function formatValue(v: unknown, fmt: ValueFormat = 'number'): string {
  const n = toNumber(v)
  if (n === null) return v === null || v === undefined ? '' : String(v)
  const a = Math.abs(n)
  switch (fmt) {
    case 'compact': {
      for (const [div, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']] as const) {
        if (a >= div) return trimZeros((n / div).toFixed(1)) + suffix
      }
      return Number.isInteger(n) || a >= 100 ? String(Math.round(n)) : trimZeros(n.toFixed(2))
    }
    case 'percent': {
      const p = n * 100
      return `${Math.abs(p) < 10 && !Number.isInteger(p) ? trimZeros(p.toFixed(1)) : Math.round(p)}%`
    }
    case 'multiplier':
      return `${trimZeros(n.toFixed(2))}x`
    case 'duration': {
      const sign = n < 0 ? '-' : ''
      const total = Math.round(a)
      if (total < 60) return `${sign}${total}s`
      const h = Math.floor(total / 3600)
      const m = Math.floor((total % 3600) / 60)
      const s = String(total % 60).padStart(2, '0')
      return h > 0 ? `${sign}${h}:${String(m).padStart(2, '0')}:${s}` : `${sign}${m}:${s}`
    }
    default:
      return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }
}

function valueFormat(v: unknown): ValueFormat | undefined {
  const s = str(v)
  return (VALUE_FORMATS as readonly string[]).includes(s) ? (s as ValueFormat) : undefined
}

export function chartKind(v: unknown): ChartKind {
  const s = str(v).toLowerCase()
  if ((CHART_KINDS as readonly string[]).includes(s)) return s as ChartKind
  return KIND_ALIASES[s] ?? 'bar'
}

/** `reference`: a number, a list of numbers or a list of `{value, label}`. */
export function references(v: unknown): Reference[] {
  const out: Reference[] = []
  for (const item of Array.isArray(v) ? v : [v]) {
    if (isRecord(item)) {
      const value = toNumber(item.value)
      if (value !== null) out.push(item.label != null && str(item.label) ? { value, label: str(item.label) } : { value })
    } else {
      const value = toNumber(item)
      if (value !== null) out.push({ value })
    }
  }
  return out
}

/** Below the first reference (and colouring by reference is on): drawn muted. */
export function isBelowReference(value: unknown, spec: Pick<ChartSpec, 'references' | 'colorByReference'>): boolean {
  const n = toNumber(value)
  return spec.colorByReference && spec.references.length > 0 && n !== null && n < spec.references[0].value
}

/** Sturges' rule, 1..30 bins; equal-width bins from min to max (the last includes max). */
export function histogram(values: number[], bins?: number): { start: number; end: number; count: number }[] {
  const vs = values.filter((v) => Number.isFinite(v))
  if (vs.length === 0) return []
  let lo = Infinity
  let hi = -Infinity
  for (const v of vs) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  const n = Math.max(1, Math.min(30, Math.round(bins && bins > 0 ? bins : Math.ceil(Math.log2(vs.length) + 1))))
  if (lo === hi) return [{ start: lo, end: hi, count: vs.length }]
  const width = (hi - lo) / n
  const out = Array.from({ length: n }, (_, i) => ({ start: lo + i * width, end: i === n - 1 ? hi : lo + (i + 1) * width, count: 0 }))
  for (const v of vs) out[Math.min(n - 1, Math.floor((v - lo) / width))].count += 1
  return out
}

function keysOf(v: unknown): string[] {
  return (typeof v === 'string' ? [v] : arr(v).map((k) => str(k))).filter(Boolean)
}

/**
 * Block props → ChartSpec. Missing keys are inferred from the first row:
 * `x` is the first text column (the first column for scatter), the series are
 * every other numeric column. The legacy dict (`{title, data, chart_type}`
 * with rows like `{name, value}`) draws without changes.
 */
export function toChartSpec(p: Record<string, unknown>): ChartSpec {
  const kind = chartKind(p.chart_type ?? p.kind)
  const labels = isRecord(p.labels) ? p.labels : {}
  const labelOf = (key: string) => str(labels[key]) || key
  let rows: Row[] = arr(p.data).slice(0, MAX_ROWS).map((r) => (isRecord(r) ? r : { value: r }))
  const first = rows[0] ?? {}
  const keys = Object.keys(first)
  const isNum = (k: string) => toNumber(first[k]) !== null
  const y2Key = str(p.y2) || undefined
  let x = str(p.x)
  if (!x) x = (kind === 'scatter' || kind === 'histogram' ? keys.find(isNum) : keys.find((k) => !isNum(k))) ?? keys[0] ?? 'x'
  let yKeys = keysOf(p.y)
  if (yKeys.length === 0) yKeys = keys.filter((k) => k !== x && k !== y2Key && k !== str(p.label) && isNum(k))
  if (kind === 'pie' || kind === 'donut') yKeys = yKeys.slice(0, 1)

  let xFormat = valueFormat(p.x_format)
  if (kind === 'histogram') {
    const measured = str(p.x) || keysOf(p.y)[0] || x
    const fmt = xFormat
    rows = histogram(
      rows.map((r) => toNumber(r[measured])).filter((v): v is number => v !== null),
      num(p.bins, 0),
    ).map((b) => ({ bin: `${formatValue(b.start, fmt ?? 'compact')}–${formatValue(b.end, fmt ?? 'compact')}`, count: b.count }))
    x = 'bin'
    xFormat = undefined
    yKeys = ['count']
  } else {
    // Plotted values as numbers (numeric strings included); anything else is a gap.
    const numeric = [...yKeys, ...(y2Key ? [y2Key] : []), ...(kind === 'scatter' ? [x] : [])]
    rows = rows.map((r) => {
      const out: Row = { ...r }
      for (const k of numeric) out[k] = toNumber(r[k])
      return out
    })
  }

  const series = yKeys.map((key, i) => ({ key, label: kind === 'histogram' ? str(labels.count) || 'Count' : labelOf(key), color: seriesColor(i) }))
  const domain = arr(p.y_domain).map(toNumber)
  const auto = kind === 'barh' ? Math.max(120, rows.length * 28 + 32) : kind === 'pie' || kind === 'donut' ? 260 : 240
  const height = Math.min(1600, Math.max(80, num(p.height, auto)))
  const pie = kind === 'pie' || kind === 'donut'
  return {
    kind,
    title: str(p.title),
    caption: str(p.caption),
    rows,
    x,
    series,
    y2: y2Key && !pie ? { key: y2Key, label: labelOf(y2Key), color: MUTED_COLOR } : undefined,
    label: str(p.label) || undefined,
    stacked: p.stacked === true && series.length > 1,
    references: pie ? [] : references(p.reference),
    colorByReference: p.color_by_reference === true,
    xFormat,
    yFormat: valueFormat(p.y_format),
    yDomain: domain.length === 2 && domain[0] !== null && domain[1] !== null ? [domain[0], domain[1]] : undefined,
    height,
    legend: typeof p.legend === 'boolean' ? p.legend : pie || series.length > 1 || !!y2Key,
  }
}

/** Shorten a tick label to `max` characters with an ellipsis. */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`
}
