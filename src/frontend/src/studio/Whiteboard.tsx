/**
 * Interactive Whiteboard canvas (`whiteboard` fence, artifact, and block).
 *
 * Security & UX guarantees:
 * - S1-safe strict color allowlist: drops url(...), expression(...), javascript:,
 *   and any non-hex/non-palette CSS value before touching inline styles.
 * - Dark-mode readable pastel stickies with explicit high-contrast ink.
 * - Interactive drag-to-reposition nodes (arrows track live), zoom in/out/reset,
 *   add sticky note inline, fullscreen modal (Esc to close), and 1-click SVG/JSON export.
 * - Loop-based canvas bounds (no Math.max(...spread) RangeError on large boards)
 *   and React useId() unique SVG arrow marker IDs (no multi-board collisions).
 */
import { useEffect, useId, useMemo, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'

export interface WhiteboardItem {
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
  label?: string
}

export interface WhiteboardDoc {
  id?: string
  title?: string
  items?: WhiteboardItem[]
}

const PALETTE = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca', '#e9d5ff', '#fed7aa'] as const
const NAMED_COLORS: Record<string, string> = {
  yellow: '#fef08a',
  green: '#bbf7d0',
  blue: '#bfdbfe',
  red: '#fecaca',
  pink: '#fbcfe8',
  purple: '#e9d5ff',
  orange: '#fed7aa',
  slate: '#e2e8f0',
}
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** Allow-list safe solid colors only — strictly blocks CSS url(...) exfiltration (R9/S1). */
export function safeBoardColor(raw: unknown, fallbackIndex: number): string {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (HEX_COLOR.test(trimmed)) return trimmed
    const named = NAMED_COLORS[trimmed.toLowerCase()]
    if (named) return named
  }
  return PALETTE[Math.abs(fallbackIndex) % PALETTE.length]
}

function parseBoard(content: string): WhiteboardDoc | null {
  try {
    const doc = JSON.parse(content) as unknown
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
    return doc as WhiteboardDoc
  } catch {
    return null
  }
}

function escapeXml(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function boardToSvg(title: string, nodes: WhiteboardItem[], arrows: WhiteboardItem[], width: number, height: number): string {
  const byId = new Map<string, WhiteboardItem>()
  for (const n of nodes) if (n.id) byId.set(n.id, n)
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<title>${escapeXml(title)}</title>`,
    `<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#64748b"/></marker></defs>`,
    `<rect width="${width}" height="${height}" fill="#f8fafc" rx="12"/>`,
  ]
  for (const a of arrows) {
    const from = byId.get(a.from ?? '')
    const to = byId.get(a.to ?? '')
    if (!from || !to) continue
    const x1 = (from.x ?? 0) + (from.w ?? 160)
    const y1 = (from.y ?? 0) + (from.h ?? 84) / 2
    const x2 = to.x ?? 0
    const y2 = (to.y ?? 0) + (to.h ?? 84) / 2
    parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#64748b" stroke-width="1.5" marker-end="url(#arr)"/>`)
  }
  nodes.forEach((n, i) => {
    const x = n.x ?? 0
    const y = n.y ?? 0
    const w = n.w ?? 160
    const h = n.h ?? 84
    const fill = n.type === 'group' ? 'none' : safeBoardColor(n.color, i)
    const rx = n.shape === 'ellipse' ? Math.min(w, h) / 2 : 10
    const dash = n.type === 'group' ? ' stroke-dasharray="6 4"' : ''
    if (n.type !== 'text') {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="#cbd5e1"${dash}/>`)
    }
    if (n.text) {
      parts.push(`<text x="${x + 12}" y="${y + 24}" font-family="system-ui,sans-serif" font-size="13" fill="#18181b">${escapeXml(n.text)}</text>`)
    }
  })
  parts.push('</svg>')
  return parts.join('')
}

function downloadFile(filename: string, text: string, mime: string) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 500)
}

export default function WhiteboardViewer({ content, streaming }: { content: string; streaming?: boolean }): JSX.Element {
  const markerId = `wb-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const parsed = useMemo(() => parseBoard(content), [content])

  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({})
  const [addedNodes, setAddedNodes] = useState<WhiteboardItem[]>([])
  const [zoom, setZoom] = useState(1)
  const [fullscreen, setFullscreen] = useState(false)
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null)

  useEffect(() => {
    setPositions({})
    setAddedNodes([])
    setZoom(1)
  }, [content])

  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  if (!parsed) {
    if (streaming) {
      return (
        <div data-aiui-whiteboard="streaming" className="my-3 flex h-40 items-center justify-center rounded-xl border border-hairline bg-card text-xs text-tier-3">
          Drawing whiteboard…
        </div>
      )
    }
    return <p className="p-4 text-sm text-tier-3">This whiteboard is not valid JSON.</p>
  }

  const rawItems = Array.isArray(parsed.items) ? parsed.items : []
  const allItems = [...rawItems, ...addedNodes]
  const arrows = allItems.filter((item) => item && typeof item === 'object' && item.type === 'arrow')
  const nodes = allItems
    .filter((item) => item && typeof item === 'object' && item.type !== 'arrow')
    .map((n, i) => {
      const id = n.id ?? `node-${i}`
      const moved = positions[id]
      return {
        ...n,
        id,
        x: moved ? moved.x : typeof n.x === 'number' && Number.isFinite(n.x) ? n.x : 24 + (i % 3) * 190,
        y: moved ? moved.y : typeof n.y === 'number' && Number.isFinite(n.y) ? n.y : 24 + Math.floor(i / 3) * 116,
        w: typeof n.w === 'number' && n.w > 0 ? n.w : 168,
        h: typeof n.h === 'number' && n.h > 0 ? n.h : 84,
      }
    })

  // Loop-based bounds (never spread into Math.max so large boards cannot throw RangeError).
  let maxX = 560
  let maxY = 300
  for (const n of nodes) {
    const rx = n.x + n.w + 32
    const ry = n.y + n.h + 32
    if (rx > maxX) maxX = rx
    if (ry > maxY) maxY = ry
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const title = parsed.title || 'Whiteboard'
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>, id: string, origX: number, origY: number) {
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, origX, origY }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current
    if (!d) return
    const dx = (e.clientX - d.startX) / zoom
    const dy = (e.clientY - d.startY) / zoom
    setPositions((prev) => ({
      ...prev,
      [d.id]: { x: Math.max(8, Math.round(d.origX + dx)), y: Math.max(8, Math.round(d.origY + dy)) },
    }))
  }

  function onPointerUp() {
    dragRef.current = null
  }

  function addSticky() {
    const idx = nodes.length
    setAddedNodes((prev) => [
      ...prev,
      {
        id: `user-note-${Date.now()}`,
        type: 'sticky',
        text: `New note ${prev.length + 1}`,
        x: 32 + (idx % 3) * 184,
        y: Math.max(24, maxY - 100),
        w: 168,
        h: 84,
        color: PALETTE[idx % PALETTE.length],
      },
    ])
  }

  const board = (
    <div
      data-aiui-whiteboard="ready"
      className={
        fullscreen
          ? 'fixed inset-0 z-50 m-4 flex flex-col overflow-hidden rounded-xl border border-hairline bg-card shadow-xl'
          : 'not-prose my-3 overflow-hidden rounded-xl border border-hairline bg-card'
      }
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-fill-4 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium text-tier-1">{title}</span>
          <span className="text-tier-3">
            {nodes.length} items · drag to arrange
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={addSticky} className="h-7 rounded-md border border-hairline bg-background px-2 text-xs text-tier-2 hover:text-foreground">
            + Sticky
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.15) * 100) / 100))} className="h-7 rounded-md border border-hairline bg-background px-2 text-xs text-tier-2 hover:text-foreground">
            −
          </button>
          <button type="button" onClick={() => setZoom(1)} className="h-7 rounded-md border border-hairline bg-background px-2 font-mono text-xs text-tier-2 hover:text-foreground">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.15) * 100) / 100))} className="h-7 rounded-md border border-hairline bg-background px-2 text-xs text-tier-2 hover:text-foreground">
            +
          </button>
          <button
            type="button"
            onClick={() => downloadFile(`${slug}.svg`, boardToSvg(title, nodes, arrows, maxX, maxY), 'image/svg+xml')}
            className="h-7 rounded-md border border-hairline bg-background px-2 text-xs text-tier-2 hover:text-foreground"
          >
            SVG
          </button>
          <button
            type="button"
            onClick={() => downloadFile(`${slug}.json`, JSON.stringify({ title, items: [...nodes, ...arrows] }, null, 2), 'application/json')}
            className="h-7 rounded-md border border-hairline bg-background px-2 text-xs text-tier-2 hover:text-foreground"
          >
            JSON
          </button>
          <button
            type="button"
            onClick={() => setFullscreen((f) => !f)}
            className="h-7 rounded-md border border-hairline bg-background px-2 text-xs text-tier-2 hover:text-foreground"
          >
            {fullscreen ? 'Close' : 'Expand'}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        className={fullscreen ? 'relative flex-1 overflow-auto bg-background' : 'relative overflow-auto bg-background'}
        style={fullscreen ? undefined : { minHeight: '16rem', height: Math.min(460, Math.round(maxY * zoom) + 24) }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div
          className="relative"
          style={{ width: maxX, height: maxY, transform: `scale(${zoom})`, transformOrigin: '0 0' }}
        >
          <svg className="pointer-events-none absolute inset-0" width={maxX} height={maxY} aria-hidden>
            <defs>
              <marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
                <path d="M0,0 L7,3 L0,6 Z" fill="currentColor" className="text-tier-3" />
              </marker>
            </defs>
            {arrows.map((a, i) => {
              const from = byId.get(a.from ?? '')
              const to = byId.get(a.to ?? '')
              if (!from || !to) return null
              const fcX = from.x + from.w / 2
              const fcY = from.y + from.h / 2
              const tcX = to.x + to.w / 2
              const tcY = to.y + to.h / 2
              const horiz = Math.abs(tcX - fcX) >= Math.abs(tcY - fcY)
              const x1 = horiz ? (tcX >= fcX ? from.x + from.w : from.x) : fcX
              const y1 = horiz ? fcY : tcY >= fcY ? from.y + from.h : from.y
              const x2 = horiz ? (tcX >= fcX ? to.x : to.x + to.w) : tcX
              const y2 = horiz ? tcY : tcY >= fcY ? to.y : to.y + to.h
              const mx = (x1 + x2) / 2
              const my = (y1 + y2) / 2 - 6
              return (
                <g key={`${a.from}-${a.to}-${i}`}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="currentColor"
                    strokeWidth={1.5}
                    className="text-tier-3"
                    markerEnd={`url(#${markerId})`}
                  />
                  {a.label && (
                    <text x={mx} y={my} textAnchor="middle" fontSize="11" fill="currentColor" className="text-tier-2">
                      {a.label}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>

          {nodes.map((n, i) => {
            const isGroup = n.type === 'group'
            const isText = n.type === 'text'
            const isStickyOrShape = !isGroup && !isText
            const bg = isStickyOrShape ? safeBoardColor(n.color, i) : undefined
            return (
              <div
                key={n.id}
                onPointerDown={(e) => onPointerDown(e, n.id, n.x, n.y)}
                className={
                  isGroup
                    ? 'absolute rounded-xl border border-dashed border-hairline bg-fill-4 p-2.5 text-xs font-medium text-tier-2 active:cursor-grabbing'
                    : isText
                      ? 'absolute text-sm font-semibold text-foreground active:cursor-grabbing'
                      : 'absolute overflow-hidden rounded-lg border border-hairline p-2.5 text-xs leading-snug font-medium shadow-xs select-none active:cursor-grabbing'
                }
                style={{
                  left: n.x,
                  top: n.y,
                  width: n.w,
                  height: isText ? undefined : n.h,
                  cursor: 'grab',
                  backgroundColor: bg,
                  color: bg ? '#18181b' : undefined,
                  borderRadius: n.shape === 'ellipse' ? 999 : undefined,
                }}
              >
                {n.text}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )

  return fullscreen ? (
    <>
      <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm" onClick={() => setFullscreen(false)} />
      {board}
    </>
  ) : (
    board
  )
}
