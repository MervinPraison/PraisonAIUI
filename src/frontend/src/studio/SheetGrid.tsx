/**
 * Interactive Spreadsheet viewer (`sheet` fence, artifact, and block).
 *
 * Features beyond static tables:
 * - Multi-tab workbooks (`tabs: [{ name, grid, values }]`) AND simple `{ headers, rows }`
 * - Live cell editing + live formula bar (`=SUM(B2:B5)`, `AVERAGE`, `IF`, `MIN`, `MAX`, arithmetic)
 * - Instant row search/filter + column letter headers (A, B, C...) & row numbers
 * - One-click CSV and JSON export
 * - Streaming-safe placeholder while JSON is incomplete; malformed-JSON resilient
 */
import { useMemo, useState, type JSX } from 'react'
import { colLabel, evaluateSheet, sheetToCsv } from './formula'

export interface SheetTab {
  name?: string
  grid?: unknown[][]
  values?: unknown[][]
}

export interface SheetBook {
  id?: string
  title?: string
  tabs?: SheetTab[]
  headers?: unknown[]
  rows?: unknown[][]
}

function parseBook(content: string): SheetBook | null {
  try {
    const doc = JSON.parse(content) as unknown
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
    return doc as SheetBook
  } catch {
    return null
  }
}

function normalizeTabs(book: SheetBook): { name: string; grid: unknown[][]; precomputed?: unknown[][] }[] {
  if (Array.isArray(book.tabs) && book.tabs.length > 0) {
    return book.tabs.map((t, i) => {
      const grid = Array.isArray(t?.grid)
        ? t.grid.map((r) => (Array.isArray(r) ? [...r] : []))
        : Array.isArray(t?.values)
          ? t.values.map((r) => (Array.isArray(r) ? [...r] : []))
          : []
      const pre = Array.isArray(t?.values) ? t.values.map((r) => (Array.isArray(r) ? [...r] : [])) : undefined
      return { name: typeof t?.name === 'string' && t.name.trim() ? t.name : `Sheet ${i + 1}`, grid, precomputed: pre }
    })
  }
  if (Array.isArray(book.headers) || Array.isArray(book.rows)) {
    const rows: unknown[][] = []
    if (Array.isArray(book.headers)) rows.push([...book.headers])
    if (Array.isArray(book.rows)) {
      for (const r of book.rows) rows.push(Array.isArray(r) ? [...r] : [r])
    }
    return [{ name: book.title || 'Sheet 1', grid: rows }]
  }
  return []
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '#ERR!'
    return Number.isInteger(value) ? value.toLocaleString() : (Math.round(value * 1000) / 1000).toLocaleString()
  }
  return String(value)
}

function triggerDownload(filename: string, text: string, mime: string) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 500)
}

export interface SheetSavePayload {
  id?: string
  title?: string
  tab: string
  grid: unknown[][]
  values: unknown[][]
  tabs: { name: string; grid: unknown[][]; values: unknown[][] }[]
}

export default function SheetViewer({
  content,
  streaming,
  onSave,
  saveLabel,
}: {
  content: string
  streaming?: boolean
  onSave?: (payload: SheetSavePayload) => Promise<boolean | void>
  saveLabel?: string
}): JSX.Element {
  const book = useMemo(() => parseBook(content), [content])

  if (!book) {
    if (streaming) {
      return (
        <div data-aiui-sheet="streaming" className="my-3 flex h-32 items-center justify-center rounded-xl border border-hairline bg-card text-xs text-tier-3">
          Building spreadsheet…
        </div>
      )
    }
    return <p className="p-4 text-sm text-tier-3">This sheet is not valid JSON.</p>
  }

  return <SheetGridInner key={content} book={book} onSave={onSave} saveLabel={saveLabel} />
}

function SheetGridInner({
  book,
  onSave,
  saveLabel,
}: {
  book: SheetBook
  onSave?: (payload: SheetSavePayload) => Promise<boolean | void>
  saveLabel?: string
}): JSX.Element {
  const initialTabs = useMemo(() => normalizeTabs(book), [book])

  const [tabIdx, setTabIdx] = useState(0)
  const [edits, setEdits] = useState<Record<string, unknown>>({})
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(null)
  const [editing, setEditing] = useState<{ r: number; c: number; draft: string; source: 'cell' | 'bar' } | null>(null)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)

  const safeTab = Math.min(tabIdx, Math.max(0, initialTabs.length - 1))
  const activeTab = initialTabs[safeTab]

  const mergedGrid = useMemo(() => {
    if (!activeTab) return []
    const hasEdits = Object.keys(edits).length > 0
    return activeTab.grid.map((row, r) =>
      row.map((cell, c) => {
        const k = `${safeTab}:${r}:${c}`
        return hasEdits && k in edits ? edits[k] : cell
      }),
    )
  }, [activeTab, edits, safeTab])

  const computed = useMemo(() => {
    if (!activeTab) return []
    const hasTabEdits = Object.keys(edits).some((k) => k.startsWith(`${safeTab}:`))
    // If untouched and precomputed values exist with no local edits, evaluate formulas live so
    // any formulas without precomputed values still compute accurately.
    const live = evaluateSheet(mergedGrid)
    if (!hasTabEdits && activeTab.precomputed) {
      return live.map((row, r) =>
        row.map((val, c) => {
          const raw = mergedGrid[r]?.[c]
          if (typeof raw === 'string' && raw.trim().startsWith('=') && typeof val === 'string' && val.startsWith('#')) {
            return activeTab.precomputed?.[r]?.[c] ?? val
          }
          return val
        }),
      )
    }
    return live
  }, [activeTab, edits, mergedGrid, safeTab])

  const maxCols = useMemo(() => {
    let m = 0
    for (const r of mergedGrid) if (r.length > m) m = r.length
    return m
  }, [mergedGrid])

  const q = query.trim().toLowerCase()
  const visibleRowIndices = useMemo(() => {
    const out: number[] = []
    for (let r = 0; r < computed.length; r++) {
      if (!q || r === 0) {
        out.push(r)
        continue
      }
      const row = computed[r] ?? []
      if (row.some((cell) => String(cell ?? '').toLowerCase().includes(q))) out.push(r)
    }
    return out
  }, [computed, q])

  function commitEdit(r: number, c: number, draft: string) {
    const trimmed = draft.trim()
    const parsed: unknown = trimmed !== '' && !trimmed.startsWith('=') && !Number.isNaN(Number(trimmed)) ? Number(trimmed) : draft
    setEdits((prev) => ({ ...prev, [`${safeTab}:${r}:${c}`]: parsed }))
    setEditing(null)
  }

  const selRaw = selected ? mergedGrid[selected.r]?.[selected.c] : undefined
  const selVal = selected ? computed[selected.r]?.[selected.c] : undefined
  const slug = (book.title || activeTab?.name || 'sheet').toLowerCase().replace(/[^a-z0-9]+/g, '-')

  async function handleSave() {
    if (!onSave || saving) return
    setSaving(true)
    try {
      const hasEdits = Object.keys(edits).length > 0
      const allTabs = initialTabs.map((t, idx) => {
        const grid = t.grid.map((row, r) =>
          row.map((cell, c) => {
            const k = `${idx}:${r}:${c}`
            return hasEdits && k in edits ? edits[k] : cell
          }),
        )
        return { name: t.name, grid, values: evaluateSheet(grid) }
      })
      const cur = allTabs[safeTab] ?? { name: activeTab?.name || 'Sheet 1', grid: mergedGrid, values: computed }
      await onSave({
        ...(book.id ? { id: book.id } : {}),
        ...(book.title ? { title: book.title } : {}),
        tab: cur.name,
        grid: cur.grid,
        values: cur.values,
        tabs: allTabs,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-aiui-sheet="ready" className="not-prose my-3 overflow-hidden rounded-xl border border-hairline bg-card text-foreground">
      {/* Header & actions */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-fill-4 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium text-tier-1">{book.title || 'Spreadsheet'}</span>
          <span className="text-tier-3">
            {mergedGrid.length} rows × {maxCols} cols
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter rows…"
            aria-label="Filter spreadsheet rows"
            className="h-7 w-32 rounded-md border border-hairline bg-background px-2 text-xs text-foreground placeholder:text-tier-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="button"
            onClick={() => triggerDownload(`${slug}.csv`, sheetToCsv(computed), 'text/csv;charset=utf-8')}
            className="h-7 rounded-md border border-hairline bg-background px-2 text-xs text-tier-2 hover:text-foreground"
          >
            CSV
          </button>
          <button
            type="button"
            onClick={() => triggerDownload(`${slug}.json`, JSON.stringify({ title: book.title, tabs: [{ name: activeTab?.name, grid: mergedGrid, values: computed }] }, null, 2), 'application/json')}
            className="h-7 rounded-md border border-hairline bg-background px-2 text-xs text-tier-2 hover:text-foreground"
          >
            JSON
          </button>
          {onSave && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="h-7 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : saveLabel || 'Save'}
            </button>
          )}
        </div>
      </div>

      {/* Formula bar */}
      <div className="flex items-center gap-2 border-b border-hairline bg-background px-3 py-1.5 font-mono text-xs">
        <span className="w-10 shrink-0 rounded bg-fill-4 px-1.5 py-0.5 text-center text-tier-2">
          {selected ? `${colLabel(selected.c)}${selected.r + 1}` : 'fx'}
        </span>
        {editing?.source === 'bar' ? (
          <input
            autoFocus
            value={editing.draft}
            onChange={(e) => setEditing({ ...editing, draft: e.target.value })}
            onBlur={() => commitEdit(editing.r, editing.c, editing.draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit(editing.r, editing.c, editing.draft)
              if (e.key === 'Escape') setEditing(null)
            }}
            aria-label="Formula bar input"
            className="min-w-0 flex-1 bg-transparent text-foreground focus:outline-none"
          />
        ) : editing?.source === 'cell' ? (
          <span className="min-w-0 flex-1 truncate text-left text-foreground">{editing.draft}</span>
        ) : (
          <button
            type="button"
            disabled={!selected}
            onClick={() => selected && setEditing({ r: selected.r, c: selected.c, draft: selRaw == null ? '' : String(selRaw), source: 'bar' })}
            className="min-w-0 flex-1 truncate text-left text-tier-2 disabled:opacity-60"
          >
            {selected
              ? typeof selRaw === 'string' && selRaw.startsWith('=')
                ? `${selRaw}  →  ${formatCell(selVal)}`
                : formatCell(selRaw) || '(empty — click to edit)'
              : 'Click any cell to inspect or double-click to edit formulas (=SUM, =AVG, =IF)'}
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="max-h-96 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-fill-4 text-tier-3">
              <th className="w-9 border-b border-r border-hairline px-2 py-1 text-center font-normal">#</th>
              {Array.from({ length: maxCols }, (_, c) => (
                <th key={c} className="border-b border-r border-hairline px-2 py-1 text-center font-medium">
                  {colLabel(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRowIndices.map((r) => {
              const row = computed[r] ?? []
              const rawRow = mergedGrid[r] ?? []
              const isHeaderRow = r === 0
              return (
                <tr key={r} className={isHeaderRow ? 'bg-fill-4 font-medium' : 'hover:bg-muted/40'}>
                  <td className="border-b border-r border-hairline bg-fill-4 px-2 py-1 text-center font-mono text-tier-3">
                    {r + 1}
                  </td>
                  {Array.from({ length: maxCols }, (_, c) => {
                    const cell = row[c]
                    const raw = rawRow[c]
                    const isFormula = typeof raw === 'string' && raw.trim().startsWith('=')
                    const isNum = typeof cell === 'number'
                    const isSel = selected?.r === r && selected?.c === c
                    const isEdit = editing?.source === 'cell' && editing.r === r && editing.c === c
                    return (
                      <td
                        key={c}
                        title={isFormula ? String(raw) : undefined}
                        onClick={() => setSelected({ r, c })}
                        onDoubleClick={() => {
                          setSelected({ r, c })
                          setEditing({ r, c, draft: raw == null ? '' : String(raw), source: 'cell' })
                        }}
                        style={{ cursor: 'cell' }}
                        className={`relative border-b border-r border-hairline px-2.5 py-1.5 whitespace-nowrap ${
                          isNum ? 'text-right font-mono tabular-nums' : 'text-left'
                        } ${isSel ? 'ring-1 ring-inset ring-ring bg-fill-4' : ''}`}
                      >
                        {isEdit ? (
                          <input
                            autoFocus
                            value={editing.draft}
                            onChange={(e) => setEditing({ ...editing, draft: e.target.value })}
                            onBlur={() => commitEdit(r, c, editing.draft)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit(r, c, editing.draft)
                              if (e.key === 'Escape') setEditing(null)
                            }}
                            aria-label={`Edit cell ${colLabel(c)}${r + 1}`}
                            style={{ minWidth: '4rem' }}
                            className="w-full bg-background px-1 text-foreground focus:outline-none"
                          />
                        ) : (
                          <span>{formatCell(cell)}</span>
                        )}
                        {isFormula && !isEdit && (
                          <span aria-hidden style={{ top: 2, right: 2 }} className="absolute size-1.5 rounded-full bg-primary opacity-70" />
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Bottom tabs bar */}
      {initialTabs.length > 1 && (
        <div className="flex items-center gap-1 border-t border-hairline bg-fill-4 px-2 py-1" role="tablist">
          {initialTabs.map((t, i) => (
            <button
              key={`${t.name}-${i}`}
              type="button"
              role="tab"
              aria-selected={i === safeTab}
              onClick={() => {
                setTabIdx(i)
                setSelected(null)
                setEditing(null)
              }}
              className={`rounded-md px-2.5 py-1 text-xs ${
                i === safeTab ? 'bg-background font-medium text-foreground shadow-xs' : 'text-tier-3 hover:text-foreground'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
