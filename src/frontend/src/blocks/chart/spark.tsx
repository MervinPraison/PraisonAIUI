/**
 * Sparkline and benchmark helpers shared by the `metric` block (blocks
 * chunk) and the `sparkline` chart kind (chart chunk). Plain SVG and a few
 * lines of maths: no chart library, so the metric card stays light.
 */
import type { JSX } from 'react'

/** Upper bound on drawn sparkline points (a page payload is untrusted). */
export const MAX_SPARK_POINTS = 500

// eslint-disable-next-line react-refresh/only-export-components
export function sparkValues(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  const out: number[] = []
  for (const x of v.slice(-MAX_SPARK_POINTS)) {
    const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN
    if (Number.isFinite(n)) out.push(n)
  }
  return out
}

/**
 * SVG path for `values` in a `w` × `h` box (y grows down), with `pad` px
 * kept free at top and bottom. `domain` shares one scale between lines.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function sparkPath(values: number[], w: number, h: number, domain?: [number, number], pad = 2): string {
  if (values.length === 0) return ''
  const lo = domain ? domain[0] : Math.min(...values)
  const hi = domain ? domain[1] : Math.max(...values)
  const span = hi - lo || 1
  const step = values.length > 1 ? w / (values.length - 1) : 0
  const y = (v: number) => (hi === lo ? h / 2 : pad + (1 - (v - lo) / span) * (h - 2 * pad))
  const pts = values.length === 1 ? [[0, y(values[0])], [w, y(values[0])]] : values.map((v, i) => [i * step, y(v)])
  return pts.map(([px, py], i) => `${i ? 'L' : 'M'}${round(px)} ${round(py)}`).join('')
}

const round = (n: number) => Math.round(n * 100) / 100

/**
 * A tiny trend line with no axes. It stretches to its container's width
 * (the stroke keeps its width), so it needs no measuring.
 */
export function Sparkline({ values, height = 32, color = 'var(--chart-1)', label, domain, fill = true }: {
  values: number[]; height?: number; color?: string; label?: string; domain?: [number, number]; fill?: boolean
}): JSX.Element | null {
  if (values.length === 0) return null
  const W = 100
  const line = sparkPath(values, W, height, domain)
  return (
    <svg role="img" aria-label={label ?? `Trend: ${values[0]} to ${values[values.length - 1]}`} viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none" className="block w-full overflow-visible" style={{ height }} data-slot="sparkline">
      {fill && <path d={`${line}L${W} ${height}L0 ${height}Z`} fill={color} fillOpacity={0.12} stroke="none" />}
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/**
 * "17x below median" / "20% above median" / "at median": `value` against
 * `benchmark`. Ratios of 2 or more read as multiples, smaller ones as a
 * percentage. `sign` is +1 above, -1 below, 0 level or not comparable
 * (either side missing, zero or negative).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function benchmarkText(value: unknown, benchmark: unknown, label = 'benchmark'): { text: string; sign: number } | null {
  const v = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  const b = typeof benchmark === 'number' ? benchmark : typeof benchmark === 'string' && benchmark.trim() !== '' ? Number(benchmark) : NaN
  if (!Number.isFinite(b)) return null
  if (!Number.isFinite(v) || v <= 0 || b <= 0) return { text: `${label} ${fmt(b)}`, sign: 0 }
  const r = v / b
  if (Math.abs(r - 1) < 0.005) return { text: `at ${label}`, sign: 0 }
  const above = r > 1
  const times = above ? r : 1 / r
  const amount = times >= 2 ? `${times >= 10 ? Math.round(times) : fmt(Math.round(times * 10) / 10)}x` : `${Math.round(Math.abs(r - 1) * 100)}%`
  return { text: `${amount} ${above ? 'above' : 'below'} ${label}`, sign: above ? 1 : -1 }
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
