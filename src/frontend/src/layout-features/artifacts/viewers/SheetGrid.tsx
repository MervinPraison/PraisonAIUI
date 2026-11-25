/** A sheet artifact: tabs and computed cells. Formulas stay visible on hover. */
import { useState, type JSX } from 'react'

interface Tab {
  name?: string
  grid?: unknown[][]
  values?: unknown[][]
}

interface Book {
  title?: string
  tabs?: Tab[]
}

function parse(content: string): Book | null {
  try {
    const doc = JSON.parse(content) as Book
    return doc && typeof doc === 'object' ? doc : null
  } catch {
    return null
  }
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'number' && !Number.isInteger(value)) return String(Math.round(value * 1000) / 1000)
  return String(value)
}

export default function SheetViewer({ content }: { content: string }): JSX.Element {
  const book = parse(content)
  const [tab, setTab] = useState(0)
  if (!book) return <p className="p-4 text-sm text-tier-3">This sheet is not valid JSON.</p>
  const tabs = book.tabs ?? []
  const current = tabs[Math.min(tab, Math.max(0, tabs.length - 1))]
  const values = current?.values ?? current?.grid ?? []
  const raw = current?.grid ?? []
  return (
    <div className="overflow-hidden rounded-lg border border-hairline">
      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-hairline bg-sidebar px-2 py-1" role="tablist">
          {tabs.map((t, i) => (
            <button
              key={t.name ?? i}
              type="button"
              role="tab"
              aria-selected={i === tab}
              className={i === tab ? 'rounded px-2 py-1 text-sm font-medium' : 'rounded px-2 py-1 text-sm text-tier-3'}
              onClick={() => setTab(i)}
            >
              {t.name || `Sheet ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {values.map((row, r) => (
              <tr key={r}>
                {(Array.isArray(row) ? row : []).map((cell, c) => {
                  const formula = Array.isArray(raw[r]) ? raw[r][c] : undefined
                  const tip = typeof formula === 'string' && formula.startsWith('=') ? formula : undefined
                  return (
                    <td key={c} title={tip} className="border border-hairline px-2 py-1 align-top whitespace-nowrap">
                      {show(cell)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
