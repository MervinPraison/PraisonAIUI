/**
 * The `chart` block (praisonaiui/ui.py `chart()`), drawn with recharts.
 * Registered lazily by blocks/coreBlocks.tsx: this module and the chart
 * library are a chunk of their own, fetched only when a page shows a chart.
 *
 * Colours come from the theme's chart tokens (`--chart-1..5`), text and lines
 * from `--muted-foreground` / `--border`, so light and dark follow the theme.
 * The plot takes the container's measured width, so it fits a phone.
 *
 * Kinds: `KINDS` maps each kind to its renderer. A new kind is one entry
 * there plus its name in model.ts `CHART_KINDS`. `heatmap` and `sparkline`
 * are plain SVG (Heatmap.tsx, spark.tsx). A `facet` key draws one small
 * chart per facet value in a grid, all on one value scale.
 */
import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from 'react'
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import { cn } from '@/lib/utils'
import type { BlockNode } from '@/sdk/registry'
import { useInFrame } from '../context'
import { HeatLegend, Heatmap } from './Heatmap'
import { facetSpecs, formatValue, isBelowReference, MUTED_COLOR, seriesColor, toChartSpec, toNumber, truncate, type ChartKind, type ChartSpec, type Row, type ValueFormat } from './model'
import { Sparkline } from './spark'

const TICK = { fill: 'var(--muted-foreground)', fontSize: 11 }
const AXIS_LINE = { stroke: 'var(--border)' }
const GRID = 'var(--border)'
const CHAR_PX = 6.5
const MARGIN = { top: 8, right: 12, bottom: 4, left: 4 }

/** Axis ticks are short (k/M) unless a format is set; tooltips show the full number. */
const axisFmt = (f?: ValueFormat): ValueFormat => f ?? 'compact'
const tipFmt = (f?: ValueFormat): ValueFormat => f ?? 'number'

function useWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(Math.floor(el.getBoundingClientRect().width))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

// ── tooltip ───────────────────────────────────────────────────────────

type TipEntry = { dataKey?: unknown; name?: unknown; value?: unknown; color?: string; payload?: unknown }

function ChartTooltip({ spec, active, payload, label }: { spec: ChartSpec; active?: boolean; payload?: readonly TipEntry[]; label?: unknown }) {
  if (!active || !payload?.length) return null
  const row = (payload[0].payload ?? {}) as Row
  const scatter = spec.kind === 'scatter'
  const title = scatter ? (spec.label ? String(row.name ?? '') : '') : formatValue(label ?? row[spec.x], spec.kind === 'histogram' ? undefined : spec.xFormat)
  const entries = scatter
    ? [
        { name: spec.x, value: formatValue(row.x, tipFmt(spec.xFormat)), color: undefined },
        { name: String(row.series ?? ''), value: formatValue(row.y, tipFmt(spec.yFormat)), color: String(row.color ?? '') },
      ]
    : [...payload].sort((a, b) => Number(a.dataKey === spec.y2?.key) - Number(b.dataKey === spec.y2?.key)).map((e) => {
        const key = String(e.dataKey ?? '')
        const pie = spec.kind === 'pie' || spec.kind === 'donut'
        const s = spec.series.find((x) => x.key === key)
        const isY2 = spec.y2?.key === key
        return {
          name: pie ? String(e.name ?? '') : (s?.label ?? (isY2 ? spec.y2?.label : key) ?? key),
          value: formatValue(e.value, isY2 ? 'number' : tipFmt(spec.yFormat)),
          color: isY2 ? MUTED_COLOR : (e.color ?? s?.color),
        }
      })
  return (
    <div className="min-w-32 rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {title && <div className="mb-1 font-medium text-foreground">{title}</div>}
      <ul className="flex flex-col gap-0.5">
        {entries.map((e, i) => (
          <li key={i} className="flex items-center gap-2">
            {e.color && <span aria-hidden className="size-2 shrink-0 rounded-sm" style={{ background: e.color }} />}
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{e.name}</span>
            <span className="font-medium tabular-nums text-foreground">{e.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function tooltip(spec: ChartSpec, cursor: object | boolean) {
  return (
    <Tooltip cursor={cursor} isAnimationActive={false}
      content={(p) => <ChartTooltip spec={spec} active={p.active} payload={p.payload as readonly TipEntry[] | undefined} label={p.label} />}
    />
  )
}

function referenceLines(spec: ChartSpec, axis: 'x' | 'y') {
  return spec.references.map((r, i) => (
    <ReferenceLine key={`ref-${i}`} {...{ [axis]: r.value }} stroke={MUTED_COLOR} strokeDasharray="4 4" strokeOpacity={0.8} ifOverflow="extendDomain"
      label={r.label ? { value: r.label, position: axis === 'x' ? 'top' : 'insideTopRight', fill: 'var(--muted-foreground)', fontSize: 11 } : undefined}
    />
  ))
}

/** Width of a value axis: its widest tick label. */
function valueAxisWidth(spec: ChartSpec): number {
  let longest = 1
  for (const r of spec.rows) for (const s of spec.series) longest = Math.max(longest, formatValue(r[s.key], axisFmt(spec.yFormat)).length)
  for (const r of spec.references) longest = Math.max(longest, formatValue(r.value, axisFmt(spec.yFormat)).length)
  return Math.min(64, Math.round(longest * CHAR_PX + 12))
}

// ── kinds ─────────────────────────────────────────────────────────────

type KindRenderer = (spec: ChartSpec, width: number) => JSX.Element

/** bar, barh, line, area, histogram: one ComposedChart, with optional y2 bars behind. */
const cartesian: KindRenderer = (spec, width) => {
  const horizontal = spec.kind === 'barh'
  const bars = spec.kind === 'bar' || spec.kind === 'barh' || spec.kind === 'histogram'
  const stackId = spec.stacked ? 'stack' : undefined
  const fmtX = (v: unknown) => formatValue(v, spec.xFormat)
  const fmtY = (v: unknown) => formatValue(v, axisFmt(spec.yFormat))
  // Bars and areas grow from zero; a line fits its data.
  const domain = spec.yDomain ?? (spec.kind === 'line' ? ['auto', 'auto'] : [(min: number) => Math.min(0, min), 'auto'])
  const labelChars = Math.max(...spec.rows.map((r) => String(r[spec.x] ?? '').length), 1)
  const labelWidth = Math.max(40, Math.min(labelChars * CHAR_PX + 8, width * 0.38, 180))
  const maxChars = Math.max(3, Math.floor((labelWidth - 8) / CHAR_PX))
  const byReference = spec.colorByReference && spec.series.length === 1
  return (
    <ComposedChart
      width={width}
      height={spec.height}
      data={spec.rows}
      layout={horizontal ? 'vertical' : 'horizontal'}
      margin={horizontal && spec.references.some((r) => r.label) ? { ...MARGIN, top: 22 } : MARGIN}
      barCategoryGap={spec.kind === 'histogram' ? 1 : '20%'}
      accessibilityLayer
    >
      <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={!horizontal} vertical={horizontal} />
      {horizontal ? (
        <>
          <XAxis type="number" tickFormatter={fmtY} domain={domain} tick={TICK} tickLine={false} axisLine={AXIS_LINE} />
          <YAxis type="category" dataKey={spec.x} width={labelWidth} interval={0} tick={TICK} tickLine={false} axisLine={AXIS_LINE}
            tickFormatter={(v: unknown) => truncate(fmtX(v), maxChars)} />
        </>
      ) : (
        <>
          <XAxis dataKey={spec.x} tickFormatter={fmtX} tick={TICK} tickLine={false} axisLine={AXIS_LINE} minTickGap={12} interval="preserveStartEnd" />
          <YAxis width={valueAxisWidth(spec)} tickFormatter={fmtY} domain={domain} tick={TICK} tickLine={false} axisLine={false} allowDataOverflow={!!spec.yDomain} />
          {spec.y2 && <YAxis yAxisId="y2" orientation="right" hide domain={[0, (max: number) => (max || 1) * 2]} />}
        </>
      )}
      {tooltip(spec, bars ? { fill: 'var(--muted)', opacity: 0.6 } : { stroke: 'var(--border)' })}
      {spec.y2 && !horizontal && (
        <Bar yAxisId="y2" dataKey={spec.y2.key} name={spec.y2.label} fill={MUTED_COLOR} fillOpacity={0.18} isAnimationActive={false} />
      )}
      {spec.series.map((s) => {
        if (spec.kind === 'line')
          return <Line key={s.key} dataKey={s.key} name={s.label} type="monotone" stroke={s.color} strokeWidth={2} dot={spec.rows.length <= 40 ? { r: 2.5, fill: s.color } : false} connectNulls isAnimationActive={false} />
        if (spec.kind === 'area')
          return <Area key={s.key} dataKey={s.key} name={s.label} type="monotone" stroke={s.color} fill={s.color} fillOpacity={0.2} strokeWidth={2} stackId={stackId} connectNulls isAnimationActive={false} />
        return (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stackId={stackId} radius={spec.stacked ? 0 : horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]} isAnimationActive={false}>
            {byReference && spec.rows.map((r, i) => <Cell key={i} fill={isBelowReference(r[s.key], spec) ? MUTED_COLOR : s.color} fillOpacity={isBelowReference(r[s.key], spec) ? 0.45 : 1} />)}
          </Bar>
        )
      })}
      {referenceLines(spec, horizontal ? 'x' : 'y')}
    </ComposedChart>
  )
}

const scatter: KindRenderer = (spec, width) => (
  <ScatterChart width={width} height={spec.height} margin={MARGIN} accessibilityLayer>
    <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
    <XAxis type="number" dataKey="x" name={spec.x} domain={['auto', 'auto']} tickFormatter={(v: unknown) => formatValue(v, axisFmt(spec.xFormat))} tick={TICK} tickLine={false} axisLine={AXIS_LINE} />
    <YAxis type="number" dataKey="y" width={valueAxisWidth(spec)} domain={spec.yDomain ?? ['auto', 'auto']} tickFormatter={(v: unknown) => formatValue(v, axisFmt(spec.yFormat))} tick={TICK} tickLine={false} axisLine={false} />
    {tooltip(spec, { stroke: 'var(--border)', strokeDasharray: '3 3' })}
    {spec.series.map((s) => (
      <Scatter key={s.key} name={s.label} fill={s.color} isAnimationActive={false}
        data={spec.rows
          .map((r) => ({ x: r[spec.x], y: r[s.key], name: spec.label ? r[spec.label] : undefined, series: s.label, color: s.color }))
          .filter((d) => d.x !== null && d.y !== null)}
      />
    ))}
    {referenceLines(spec, 'y')}
  </ScatterChart>
)

const radial: KindRenderer = (spec, width) => {
  const s = spec.series[0]
  return (
    <PieChart width={width} height={spec.height} accessibilityLayer>
      {tooltip(spec, false)}
      {s && (
        <Pie data={spec.rows} dataKey={s.key} nameKey={spec.x} innerRadius={spec.kind === 'donut' ? '55%' : 0} outerRadius="85%" stroke="var(--background)" isAnimationActive={false}>
          {spec.rows.map((_, i) => <Cell key={i} fill={seriesColor(i)} />)}
        </Pie>
      )}
    </PieChart>
  )
}

const heatmap: KindRenderer = (spec, width) => <Heatmap spec={spec} width={width} />

/** A tiny line with no axes; the last value is printed beside it. */
const sparkline: KindRenderer = (spec) => {
  const s = spec.series[0]
  const values = spec.rows.map((r) => toNumber(r[s.key])).filter((v): v is number => v !== null)
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <Sparkline values={values} height={spec.height} color={s.color} domain={spec.yDomain} label={`${spec.title || s.label}: ${values.map((v) => formatValue(v, spec.yFormat)).join(', ')}`} />
      </div>
      {values.length > 0 && <span className="shrink-0 text-xs font-medium tabular-nums text-foreground">{formatValue(values[values.length - 1], spec.yFormat ?? 'compact')}</span>}
    </div>
  )
}

const KINDS: Record<ChartKind, KindRenderer> = {
  bar: cartesian, barh: cartesian, line: cartesian, area: cartesian, histogram: cartesian, scatter, pie: radial, donut: radial, heatmap, sparkline,
}

// ── block ─────────────────────────────────────────────────────────────

function Legend({ spec }: { spec: ChartSpec }) {
  if (spec.kind === 'heatmap') return <HeatLegend spec={spec} />
  const pie = spec.kind === 'pie' || spec.kind === 'donut'
  const items: { label: string; color: string; faint?: boolean }[] = pie
    ? spec.rows.map((r, i) => ({ label: String(r[spec.x] ?? ''), color: seriesColor(i) }))
    : [...spec.series, ...(spec.y2 ? [{ ...spec.y2, faint: true }] : [])]
  if (items.length === 0) return null
  return (
    <ul className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
      {items.map((item, i) => (
        <li key={i} className="flex min-w-0 items-center gap-1.5">
          <span aria-hidden className={cn('size-2.5 shrink-0 rounded-sm', item.faint && 'opacity-30')} style={{ background: item.color }} />
          <span className="truncate">{item.label}</span>
        </li>
      ))}
    </ul>
  )
}

/** Charts on screen. recharts keeps one hidden text-measuring <span> in <body>; the last chart to go removes it. */
let mounted = 0

function useMeasureSpanCleanup(): void {
  useEffect(() => {
    mounted++
    return () => {
      if (--mounted === 0) document.getElementById('recharts_measurement_span')?.remove()
    }
  }, [])
}

const isEmpty = (spec: ChartSpec) => spec.rows.length === 0 || (spec.series.length === 0 && spec.kind !== 'histogram')

/** One plot at its container's measured width (a heatmap sets its own height). */
function Plot({ spec }: { spec: ChartSpec }): JSX.Element {
  const [ref, width] = useWidth()
  const empty = isEmpty(spec)
  let plot: ReactNode = null
  if (empty) plot = <p className="py-6 text-center text-sm text-muted-foreground">No data</p>
  else if (width > 0) plot = KINDS[spec.kind](spec, width)
  return (
    <div ref={ref} className="w-full min-w-0" style={empty || spec.kind === 'heatmap' ? undefined : { height: spec.height }}>
      {plot}
    </div>
  )
}

export function ChartBlock({ node }: { node: BlockNode }): JSX.Element {
  useMeasureSpanCleanup()
  const props = node.props ?? {}
  const spec = toChartSpec(props)
  const facets = facetSpecs(props)
  const nested = useInFrame()
  const empty = isEmpty(spec)
  // Small multiples share the value scale; the legend is the first panel's.
  const legendSpec = facets[0]?.spec ?? spec
  return (
    <figure className={cn('m-0 flex min-w-0 flex-col gap-3', !nested && 'rounded-xl border border-border p-4')} data-aiui-chart={spec.kind} aria-label={spec.title || 'Chart'}>
      {spec.title && <figcaption className="text-sm font-medium text-foreground">{spec.title}</figcaption>}
      {facets.length > 0 ? (
        <ul className="m-0 grid min-w-0 list-none grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-4 p-0" data-aiui-facets={facets.length}>
          {facets.map((f) => (
            <li key={f.label} className="flex min-w-0 flex-col gap-1" aria-label={f.label}>
              <div className="truncate text-xs font-medium text-muted-foreground">{f.label || '(none)'}</div>
              <Plot spec={f.spec} />
            </li>
          ))}
        </ul>
      ) : (
        <Plot spec={spec} />
      )}
      {legendSpec.legend && !empty && <Legend spec={legendSpec} />}
      {spec.caption && <p className="text-xs text-muted-foreground">{spec.caption}</p>}
    </figure>
  )
}
