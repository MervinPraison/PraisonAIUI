/**
 * The `heatmap` chart kind: a rows × columns grid (weekday × hour) drawn in
 * plain SVG, coloured on a sequential scale from the theme's first chart
 * token. Cells keep a minimum width; on a narrow screen the grid scrolls
 * sideways inside the figure (the scroller takes keyboard focus).
 */
import { useState, type JSX } from 'react'
import { cellKey, formatValue, heatColor, heatGrid, heatT, truncate, type ChartSpec, type ValueFormat } from './model'

const CHAR_PX = 6.5
const CELL_MIN = 18
const CELL_H = 22
const HEAD = 18
const TICK = { fill: 'var(--muted-foreground)', fontSize: 11 }

type Hover = { row: string; col: string; value: number | undefined; left: number; top: number }

export function Heatmap({ spec, width }: { spec: ChartSpec; width: number }): JSX.Element {
  const g = heatGrid(spec)
  const [hover, setHover] = useState<Hover | null>(null)
  const fmtX = (v: unknown) => formatValue(v, spec.xFormat)
  const labelChars = Math.max(1, ...g.rows.map((r) => r.length))
  const labelW = Math.min(120, Math.max(32, labelChars * CHAR_PX + 8), Math.round(width * 0.3))
  const cellW = Math.max(CELL_MIN, (width - labelW) / Math.max(1, g.cols.length))
  const svgW = Math.round(labelW + cellW * g.cols.length)
  const svgH = HEAD + CELL_H * g.rows.length
  // Column labels thin out so they never overlap.
  const colChars = Math.max(1, ...g.cols.map((c) => fmtX(c).length))
  const every = Math.max(1, Math.ceil((Math.min(colChars, 8) * CHAR_PX + 6) / cellW))
  const overflow = svgW > width + 1
  const vKey = spec.series[0]?.label ?? 'value'
  return (
    <div
      className="relative w-full min-w-0 overflow-x-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={overflow ? 0 : undefined}
      role={overflow ? 'region' : undefined}
      aria-label={overflow ? `${spec.title || 'Heatmap'}, scrolls sideways` : undefined}
      onMouseLeave={() => setHover(null)}
    >
      <svg width={svgW} height={svgH} role="img" aria-label={spec.title || 'Heatmap'} className="block">
        {g.cols.map((c, ci) =>
          ci % every === 0 ? (
            <text key={c} x={labelW + ci * cellW + cellW / 2} y={HEAD - 6} textAnchor="middle" {...TICK}>
              {truncate(fmtX(c), 8)}
            </text>
          ) : null,
        )}
        {g.rows.map((r, ri) => (
          <g key={r}>
            <text x={labelW - 6} y={HEAD + ri * CELL_H + CELL_H / 2} dominantBaseline="central" textAnchor="end" {...TICK}>
              {truncate(r, Math.max(3, Math.floor((labelW - 8) / CHAR_PX)))}
            </text>
            {g.cols.map((c, ci) => {
              const v = g.cells.get(cellKey(r, c))
              const x = labelW + ci * cellW
              const y = HEAD + ri * CELL_H
              return (
                <rect key={c} x={x + 1} y={y + 1} width={cellW - 2} height={CELL_H - 2} rx={2}
                  fill={v === undefined ? 'transparent' : heatColor(heatT(v, g))}
                  stroke={v === undefined ? 'var(--border)' : 'none'}
                  onMouseEnter={() => setHover({ row: r, col: c, value: v, left: x + cellW / 2, top: y })}
                >
                  <title>{`${r}, ${fmtX(c)}: ${v === undefined ? 'no data' : formatValue(v, spec.yFormat ?? 'number')}`}</title>
                </rect>
              )
            })}
          </g>
        ))}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute z-10 min-w-28 -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
          style={{ left: hover.left, top: hover.top - 4 }} aria-hidden>
          <div className="mb-1 font-medium text-foreground">{`${hover.row}, ${fmtX(hover.col)}`}</div>
          <div className="flex items-center gap-2">
            <span className="flex-1 text-muted-foreground">{vKey}</span>
            <span className="font-medium tabular-nums text-foreground">{hover.value === undefined ? 'no data' : formatValue(hover.value, spec.yFormat ?? 'number')}</span>
          </div>
        </div>
      )}
    </div>
  )
}

/** The colour scale under a heatmap: low → high with the formatted ends. */
export function HeatLegend({ spec }: { spec: ChartSpec }): JSX.Element {
  const g = heatGrid(spec)
  const fmt: ValueFormat = spec.yFormat ?? 'compact'
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-label="Colour scale">
      <span className="tabular-nums">{formatValue(g.min, fmt)}</span>
      <span aria-hidden className="h-2 w-32 max-w-[50%] rounded-sm"
        style={{ background: `linear-gradient(to right, ${heatColor(0)}, ${heatColor(0.5)}, ${heatColor(1)})` }} />
      <span className="tabular-nums">{formatValue(g.max, fmt)}</span>
    </div>
  )
}
