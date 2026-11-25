/** A whiteboard artifact: stickies, shapes, labels, and arrows. */
import type { JSX } from 'react'

interface Item {
  id?: string
  type?: string
  text?: string
  x?: number
  y?: number
  w?: number
  h?: number
  color?: string
  shape?: string
  from?: string
  to?: string
}

interface Board {
  title?: string
  items?: Item[]
}

const COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fecaca', '#e9d5ff']

function parse(content: string): Board | null {
  try {
    const doc = JSON.parse(content) as Board
    return doc && typeof doc === 'object' ? doc : null
  } catch {
    return null
  }
}

export default function WhiteboardViewer({ content }: { content: string }): JSX.Element {
  const board = parse(content)
  if (!board) return <p className="p-4 text-sm text-tier-3">This whiteboard is not valid JSON.</p>
  const items = board.items ?? []
  const nodes = items.filter((i) => i.type !== 'arrow')
  const arrows = items.filter((i) => i.type === 'arrow')
  const byId = new Map(nodes.map((n) => [n.id ?? '', n]))
  const maxX = Math.max(480, ...nodes.map((n) => (n.x ?? 0) + (n.w ?? 160) + 24))
  const maxY = Math.max(280, ...nodes.map((n) => (n.y ?? 0) + (n.h ?? 100) + 24))
  return (
    <div className="relative min-h-64 overflow-auto rounded-lg border border-hairline bg-sidebar" style={{ height: Math.min(560, maxY + 16) }}>
      <div className="relative" style={{ width: maxX, height: maxY }}>
        <svg className="pointer-events-none absolute inset-0" width={maxX} height={maxY} aria-hidden>
          {arrows.map((a, i) => {
            const from = byId.get(a.from ?? '')
            const to = byId.get(a.to ?? '')
            if (!from || !to) return null
            const x1 = (from.x ?? 0) + (from.w ?? 160)
            const y1 = (from.y ?? 0) + (from.h ?? 80) / 2
            const x2 = to.x ?? 0
            const y2 = (to.y ?? 0) + (to.h ?? 80) / 2
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={1.5} className="text-tier-3" markerEnd="url(#wb-arrow)" />
          })}
          <defs>
            <marker id="wb-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6" fill="currentColor" className="text-tier-3" />
            </marker>
          </defs>
        </svg>
        {nodes.map((n, i) => {
          const sticky = n.type !== 'shape' && n.type !== 'text' && n.type !== 'group'
          const group = n.type === 'group'
          return (
            <div
              key={n.id ?? i}
              className={
                group
                  ? 'absolute rounded-xl border border-dashed border-hairline p-2 text-xs text-tier-3'
                  : n.type === 'text'
                    ? 'absolute text-sm font-medium'
                    : 'absolute overflow-hidden rounded-lg border border-hairline p-2 text-sm shadow-sm'
              }
              style={{
                left: n.x ?? 0,
                top: n.y ?? 0,
                width: n.w || undefined,
                height: n.h || undefined,
                background: sticky || n.type === 'shape' ? n.color ?? COLORS[i % COLORS.length] : undefined,
                borderRadius: n.shape === 'ellipse' ? 999 : undefined,
              }}
            >
              {n.text}
            </div>
          )
        })}
      </div>
    </div>
  )
}
