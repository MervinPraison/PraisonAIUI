/**
 * Pure converters for inline chat UI blocks (`type: 'block'`, `'dataframe'`, `'plotly'`).
 */
import { isRecord, str, toBlockNodes, toBlockTree } from '@/blocks/normalize'
import type { BlockNode } from '@/sdk/registry'

/** Media / file element types handled directly by ElementPart (not BlockElement). */
export const MEDIA_ELEMENT_TYPES = new Set(['image', 'video', 'audio', 'pdf', 'file', 'code'])

/** Convert a `DataframeElement` payload (`{columns, data}`) into a `table` block dict. */
export function dataframeToBlock(el: Record<string, unknown>): Record<string, unknown> {
  const payload = isRecord(el.data) ? el.data : el
  const rawCols = Array.isArray(payload.columns) ? payload.columns.map((c) => str(c)) : []
  const rawRows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.rows) ? payload.rows : []

  let headers = rawCols
  if (!headers.length && rawRows.length && isRecord(rawRows[0])) {
    headers = Object.keys(rawRows[0])
  }

  const rows: unknown[][] = rawRows.map((row) => {
    if (Array.isArray(row)) return row
    if (isRecord(row)) return headers.map((h) => row[h] ?? null)
    return [row]
  })

  if (!headers.length) {
    return { type: 'empty', text: str(el.name) ? `${str(el.name)}: no rows` : 'Empty DataFrame' }
  }

  return {
    type: 'table',
    headers,
    rows,
    searchable: true,
    sortable: true,
    ...(str(el.name) ? { caption: str(el.name) } : {}),
  }
}

function plotlyTitle(layout: Record<string, unknown> | null, fallback: string): string {
  if (layout) {
    if (typeof layout.title === 'string' && layout.title) return layout.title
    if (isRecord(layout.title) && typeof layout.title.text === 'string' && layout.title.text) {
      return layout.title.text
    }
  }
  return fallback
}

/**
 * Convert a `PlotlyElement` figure dict (`{data: traces, layout}`) into a native
 * Recharts `chart` block (no `plotly.js` bundle bloat, R10). Unsupported trace
 * types degrade cleanly to an info alert + JSON viewer.
 */
export function plotlyToBlock(el: Record<string, unknown>): Record<string, unknown> {
  const fig = isRecord(el.fig_data) ? el.fig_data : isRecord(el.data) ? el.data : null
  const fallbackTitle = str(el.name)
  if (!fig || !Array.isArray(fig.data)) {
    return { type: 'empty', text: fallbackTitle ? `${fallbackTitle}: empty Plotly figure` : 'Empty Plotly figure' }
  }

  const traces = fig.data.filter(isRecord)
  const layout = isRecord(fig.layout) ? fig.layout : null
  const title = plotlyTitle(layout, fallbackTitle)

  if (!traces.length) {
    return { type: 'empty', text: title ? `${title}: empty Plotly figure` : 'Empty Plotly figure' }
  }

  const first = traces[0]
  const traceType = str(first.type, 'scatter').toLowerCase()

  if (traceType === 'pie') {
    const labels = Array.isArray(first.labels) ? first.labels : []
    const values = Array.isArray(first.values) ? first.values : []
    const rows = labels.map((lbl, i) => ({ label: str(lbl), value: values[i] ?? 0 }))
    const hole = typeof first.hole === 'number' ? first.hole : 0
    return { type: 'chart', title, chart_type: hole > 0 ? 'donut' : 'pie', data: rows, x: 'label', y: ['value'] }
  }

  if (traceType === 'histogram') {
    const vals = Array.isArray(first.x) ? first.x : Array.isArray(first.y) ? first.y : []
    return {
      type: 'chart',
      title,
      chart_type: 'histogram',
      data: vals.map((v) => ({ value: v })),
      x: 'value',
    }
  }

  if (traceType === 'heatmap') {
    const z = Array.isArray(first.z) ? first.z : []
    const xs = Array.isArray(first.x) ? first.x : []
    const ys = Array.isArray(first.y) ? first.y : []
    const rows: Record<string, unknown>[] = []
    z.forEach((zRow, yi) => {
      if (!Array.isArray(zRow)) return
      const yLabel = yi < ys.length ? str(ys[yi]) : String(yi)
      zRow.forEach((cell, xi) => {
        const xLabel = xi < xs.length ? str(xs[xi]) : String(xi)
        rows.push({ x: xLabel, y: yLabel, value: cell })
      })
    })
    return { type: 'chart', title, chart_type: 'heatmap', data: rows, x: 'x', y: ['y'], value: 'value' }
  }

  if (traceType === 'bar' || traceType === 'scatter' || traceType === 'scattergl') {
    const isBarh = traceType === 'bar' && str(first.orientation, 'v').toLowerCase() === 'h'
    const barmode = str(layout?.barmode).toLowerCase()
    const stacked = barmode === 'stack' || barmode === 'relative'
    let chartType: string
    if (traceType === 'bar') {
      chartType = isBarh ? 'barh' : 'bar'
    } else {
      const mode = str(first.mode, 'lines').toLowerCase()
      const fill = str(first.fill).toLowerCase()
      if (fill === 'tozeroy' || fill === 'tonexty' || fill === 'toself') chartType = 'area'
      else if (mode.includes('lines')) chartType = 'line'
      else chartType = 'scatter'
    }

    if (chartType === 'scatter' && traces.length === 1) {
      const xs = Array.isArray(first.x) ? first.x : []
      const ys = Array.isArray(first.y) ? first.y : []
      const texts = Array.isArray(first.text) ? first.text : []
      const rows = xs.map((xv, i) => ({
        x: xv,
        y: ys[i] ?? null,
        ...(texts[i] != null ? { label: str(texts[i]) } : {}),
      }))
      return {
        type: 'chart',
        title,
        chart_type: 'scatter',
        data: rows,
        x: 'x',
        y: ['y'],
        ...(texts.length ? { label: 'label' } : {}),
      }
    }

    const byCat = new Map<string, Record<string, unknown>>()
    const seriesKeys: string[] = []
    traces.forEach((tr, idx) => {
      let key = str(tr.name) || `series_${idx + 1}`
      if (seriesKeys.includes(key)) key = `${key}_${idx + 1}`
      seriesKeys.push(key)
      const cats = Array.isArray(isBarh ? tr.y : tr.x) ? ((isBarh ? tr.y : tr.x) as unknown[]) : []
      const vals = Array.isArray(isBarh ? tr.x : tr.y) ? ((isBarh ? tr.x : tr.y) as unknown[]) : []
      vals.forEach((val, i) => {
        const cat = i < cats.length ? cats[i] : i
        const ck = str(cat)
        const entry = byCat.get(ck) ?? { category: cat }
        entry[key] = val
        byCat.set(ck, entry)
      })
    })
    return {
      type: 'chart',
      title,
      chart_type: chartType,
      data: [...byCat.values()],
      x: 'category',
      y: seriesKeys,
      ...(stacked ? { stacked: true } : {}),
    }
  }

  return {
    type: 'container',
    children: [
      {
        type: 'alert',
        variant: 'info',
        title: title || 'Plotly Figure',
        message: `Plotly trace type '${traceType}' is not supported by the built-in chart renderer; showing figure data.`,
      },
      { type: 'json_view', data: fig },
    ],
  }
}

/** Resolve any block/dataframe/plotly chat element into BlockNodes. */
export function elementToBlockNodes(data: Record<string, unknown>): BlockNode[] {
  const type = typeof data.type === 'string' ? data.type : ''
  if (type === 'block') {
    if (data.block !== undefined) return toBlockTree(data.block).nodes
    if (Array.isArray(data._components)) return toBlockNodes(data._components)
    return []
  }
  if (type === 'dataframe') return toBlockNodes(dataframeToBlock(data))
  if (type === 'plotly') return toBlockNodes(plotlyToBlock(data))
  if (type && !MEDIA_ELEMENT_TYPES.has(type)) return toBlockNodes(data)
  return []
}
