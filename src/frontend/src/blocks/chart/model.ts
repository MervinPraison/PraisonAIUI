/**
 * The `chart` block's data model: block props (praisonaiui/ui.py `chart()`,
 * or a hand-written dict) → a ChartSpec the renderer draws, plus the value
 * formats and histogram bins. Pure: no React, no chart library, so it is
 * unit-tested on its own and stays out of the renderer's chunk boundaries.
 */
import { arr, isRecord, num, str } from '../normalize'

export const CHART_KINDS = ['bar', 'barh', 'line', 'area', 'scatter', 'pie', 'donut', 'histogram', 'heatmap', 'sparkline'] as const
export type ChartKind = (typeof CHART_KINDS)[number]

export const VALUE_FORMATS = ['number', 'compact', 'percent', 'multiplier', 'duration'] as const
export type ValueFormat = (typeof VALUE_FORMATS)[number]

const KIND_ALIASES: Record<string, ChartKind> = { column: 'bar', columns: 'bar', hbar: 'barh', doughnut: 'donut', spark: 'sparkline' }

export type Row = Record<string, unknown>
export type Series = { key: string; label: string; color: string }
export type Reference = { value: number; label?: string }

/**
 * `x`: category key (scatter: x value; histogram: `bin`; heatmap: column key). `y2`: faint bars on their
 * own scale. `label`: scatter point name key. `row`: heatmap row key (its value key is `series[0]`).
 */
export interface ChartSpec {
  kind: ChartKind; title: string; caption: string; rows: Row[]; x: string; series: Series[]; y2?: Series; label?: string
  stacked: boolean; references: Reference[]; colorByReference: boolean; xFormat?: ValueFormat; yFormat?: ValueFormat
  yDomain?: [number, number]; height: number; legend: boolean; row?: string
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
  // The facet column splits the rows into panels: never a plotted key.
  const keys = Object.keys(first).filter((k) => k !== str(p.facet))
  const isNum = (k: string) => toNumber(first[k]) !== null
  const y2Key = str(p.y2) || undefined
  const heatmap = kind === 'heatmap'
  let x = str(p.x) || (heatmap ? 'x' : '')
  if (!x) x = (kind === 'scatter' || kind === 'histogram' ? keys.find(isNum) : keys.find((k) => !isNum(k))) ?? keys[0] ?? 'x'
  const rowKey = heatmap ? keysOf(p.y)[0] || 'y' : undefined
  let yKeys = heatmap ? [str(p.value) || 'value'] : keysOf(p.y)
  if (yKeys.length === 0) yKeys = keys.filter((k) => k !== x && k !== y2Key && k !== str(p.label) && isNum(k))
  // A sparkline of plain numbers: the one column is the line.
  if (kind === 'sparkline' && yKeys.length === 0 && isNum(x)) yKeys = [x]
  if (kind === 'pie' || kind === 'donut' || kind === 'sparkline') yKeys = yKeys.slice(0, 1)

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
  const pie = kind === 'pie' || kind === 'donut'
  const auto = kind === 'barh' ? Math.max(120, rows.length * 28 + 32) : pie ? 260 : kind === 'sparkline' ? 48 : heatmap ? 0 : 240
  const height = heatmap ? 0 : Math.min(1600, Math.max(kind === 'sparkline' ? 16 : 80, num(p.height, auto)))
  const flat = pie || heatmap || kind === 'sparkline'
  return {
    kind,
    title: str(p.title),
    caption: str(p.caption),
    rows,
    x,
    series,
    y2: y2Key && !flat ? { key: y2Key, label: labelOf(y2Key), color: MUTED_COLOR } : undefined,
    label: str(p.label) || undefined,
    stacked: p.stacked === true && series.length > 1,
    references: flat ? [] : references(p.reference),
    colorByReference: p.color_by_reference === true,
    xFormat,
    yFormat: valueFormat(p.y_format),
    yDomain: domain.length === 2 && domain[0] !== null && domain[1] !== null ? [domain[0], domain[1]] : undefined,
    height,
    legend: typeof p.legend === 'boolean' ? p.legend : heatmap || (kind !== 'sparkline' && (pie || series.length > 1 || !!y2Key)),
    row: rowKey,
  }
}

/** Shorten a tick label to `max` characters with an ellipsis. */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`
}

// ── heatmap ───────────────────────────────────────────────────────────

export interface HeatGrid { cols: string[]; rows: string[]; cells: Map<string, number>; min: number; max: number }

export const cellKey = (row: string, col: string) => `${row}\u0000${col}`

/** Rows `{x, y, value}` → a grid. Columns and rows keep first-seen order; a repeated cell sums. */
export function heatGrid(spec: Pick<ChartSpec, 'rows' | 'x' | 'row' | 'series' | 'yDomain'>): HeatGrid {
  const cols: string[] = []
  const rows: string[] = []
  const seenC = new Set<string>()
  const seenR = new Set<string>()
  const cells = new Map<string, number>()
  const vKey = spec.series[0]?.key ?? 'value'
  for (const r of spec.rows) {
    const c = str(r[spec.x])
    const y = str(r[spec.row ?? 'y'])
    if (!c || !y) continue
    if (!seenC.has(c)) {
      seenC.add(c)
      cols.push(c)
    }
    if (!seenR.has(y)) {
      seenR.add(y)
      rows.push(y)
    }
    const v = toNumber(r[vKey])
    if (v !== null) cells.set(cellKey(y, c), (cells.get(cellKey(y, c)) ?? 0) + v)
  }
  let min = Infinity
  let max = -Infinity
  for (const v of cells.values()) {
    min = Math.min(min, v)
    max = Math.max(max, v)
  }
  if (spec.yDomain) [min, max] = spec.yDomain
  if (!Number.isFinite(min)) [min, max] = [0, 0]
  return { cols, rows, cells, min, max }
}

/** Sequential scale from the theme: `t` in 0..1 → the first chart colour mixed over the muted surface. */
export function heatColor(t: number): string {
  const pct = Math.round(12 + Math.max(0, Math.min(1, t)) * 88)
  return `color-mix(in oklab, var(--chart-1) ${pct}%, var(--muted))`
}

export const heatT = (v: number, g: Pick<HeatGrid, 'min' | 'max'>) => (g.max === g.min ? 1 : (v - g.min) / (g.max - g.min))

// ── small multiples ───────────────────────────────────────────────────

/** Upper bound on facet panels. */
export const MAX_FACETS = 24

/** Value range over every facet, so the small charts share one scale. Stacked series sum per row. */
export function sharedDomain(specs: ChartSpec[]): [number, number] | undefined {
  let lo = Infinity
  let hi = -Infinity
  for (const s of specs) {
    for (const r of s.rows) {
      const vals = s.series.map((x) => toNumber(r[x.key])).filter((v): v is number => v !== null)
      const parts = s.stacked ? [vals.filter((v) => v > 0).reduce((a, b) => a + b, 0), vals.filter((v) => v < 0).reduce((a, b) => a + b, 0)] : vals
      for (const v of parts) {
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
    }
  }
  if (!Number.isFinite(lo)) return undefined
  const k = specs[0]?.kind
  if (k !== 'line' && k !== 'sparkline' && k !== 'scatter' && k !== 'heatmap') lo = Math.min(0, lo)
  return [lo, hi === lo ? lo + 1 : hi]
}

/** `facet` key → one spec per facet value (first-seen order), all on the same value domain. */
export function facetSpecs(p: Record<string, unknown>): { label: string; spec: ChartSpec }[] {
  const key = str(p.facet)
  if (!key) return []
  const groups = new Map<string, unknown[]>()
  for (const r of arr(p.data).slice(0, MAX_ROWS)) {
    if (!isRecord(r)) continue
    const label = str(r[key])
    if (!groups.has(label)) {
      if (groups.size >= MAX_FACETS) continue
      groups.set(label, [])
    }
    groups.get(label)!.push(r)
  }
  const base = { ...p, title: '', caption: '' }
  const height = p.height == null ? { height: p.kind === 'sparkline' || p.chart_type === 'sparkline' ? 48 : 160 } : {}
  const out = [...groups].map(([label, data]) => ({ label, spec: toChartSpec({ ...base, ...height, data }) }))
  const domain = out[0]?.spec.yDomain ?? sharedDomain(out.map((f) => f.spec))
  for (const f of out) f.spec.yDomain = domain
  return out
}
