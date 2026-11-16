/**
 * The chat page's side panel for a layout's `meta.chat.aside` region (ADR
 * 0003 §1.3, §1.5):
 *   desktop  a resizable panel right of the thread, collapsed until the
 *            region reports something (its badge), then open
 *   tablet   the same panel, collapsed by default
 *   phone    a "Chat | <label> (n)" switch above the page; the panel
 *            replaces the thread while its side is chosen (./aside.css)
 * On a desktop or tablet the open/close toggle goes into the chat header
 * (`slot`, a portal). The region stays mounted in every state, so it keeps
 * its own state and can report its badge while hidden. A lazy chunk.
 */
import { useCallback, useEffect, useRef, useState, type JSX, type KeyboardEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { PanelRightClose, PanelRightOpen } from 'lucide-react'
import type { RegionLoader } from '@/sdk/layouts'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import LazyRegion from '../LazyRegion'
import { useBadge, useRegionProps, useViewport } from './regionState'
import './aside.css'

export interface ChatAsideProps {
  loader: RegionLoader
  /** Phone switch, toggle and panel label, e.g. Canvas. */
  label: string
  sessionId: string | null
  /** Where the desktop/tablet toggle goes (the chat header). */
  slot?: HTMLElement | null
}

const WIDTH_KEY = 'aiui-chat-aside-width'
const MIN = 280
const DEFAULT = 420
const STEP = 16

const maxWidth = () => Math.max(MIN, Math.round(window.innerWidth * 0.6))
const clampWidth = (w: number) => Math.min(Math.max(Math.round(w), MIN), maxWidth())

function readWidth(): number {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY))
    return v ? clampWidth(v) : DEFAULT
  } catch {
    return DEFAULT
  }
}

function writeWidth(w: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(w))
  } catch {
    /* per-viewer convenience only */
  }
}

function PhoneSwitch({ label, badge, tab, onTab }: { label: string; badge: number; tab: 'chat' | 'aside'; onTab(t: 'chat' | 'aside'): void }) {
  const item = (value: 'chat' | 'aside', text: string) => (
    <button
      type="button"
      aria-pressed={tab === value}
      onClick={() => onTab(value)}
      className={cn(
        'inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
        tab === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {text}
      {value === 'aside' && badge > 0 && (
        <span className="rounded-full bg-primary/10 px-1.5 text-xs tabular-nums text-foreground" aria-label={`${badge} items`}>
          {badge}
        </span>
      )}
    </button>
  )
  return (
    <div className="order-first shrink-0 border-b border-border/70 px-4 py-2" data-chat-aside-switch data-tab={tab}>
      <div role="group" aria-label="Show" className="flex gap-1 rounded-lg bg-muted p-1">
        {item('chat', 'Chat')}
        {item('aside', label)}
      </div>
    </div>
  )
}

export default function ChatAside({ loader, label, sessionId, slot }: ChatAsideProps): JSX.Element {
  const viewport = useViewport()
  const region = useRegionProps(sessionId)
  const badge = useBadge()
  const phone = viewport === 'phone'
  const [tab, setTab] = useState<'chat' | 'aside'>('chat')
  // null: the default for the viewport. A desktop opens the panel once the
  // region has something to show (an empty canvas would take a third of the
  // page on a new chat); a tablet keeps it collapsed. The toggle always works.
  const [openChoice, setOpenChoice] = useState<boolean | null>(null)
  const open = openChoice ?? (viewport === 'desktop' && badge > 0)
  const [width, setWidth] = useState(readWidth)
  const drag = useRef<{ x: number; w: number } | null>(null)

  const commit = useCallback((w: number) => {
    const next = clampWidth(w)
    setWidth(next)
    writeWidth(next)
  }, [])

  // A smaller window may no longer fit the stored width.
  useEffect(() => {
    if (phone) return
    const fit = () => setWidth((w) => clampWidth(w))
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [phone])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, w: width }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    // The panel is on the right: dragging left widens it.
    if (drag.current) setWidth(clampWidth(drag.current.w + drag.current.x - e.clientX))
  }
  const onPointerUp = () => {
    if (!drag.current) return
    drag.current = null
    commit(width)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === 'ArrowLeft' ? STEP : e.key === 'ArrowRight' ? -STEP : 0
    if (e.key === 'Home') commit(maxWidth())
    else if (e.key === 'End') commit(MIN)
    else if (delta) commit(width + delta)
    else return
    e.preventDefault()
  }

  const shown = phone ? tab === 'aside' : open
  return (
    <>
      {phone && <PhoneSwitch label={label} badge={badge} tab={tab} onTab={setTab} />}
      {!phone && slot && createPortal(
        <Button
          variant="ghost"
          size="sm"
          aria-pressed={open}
          title={open ? `Hide the ${label.toLowerCase()}` : `Show the ${label.toLowerCase()}`}
          onClick={() => setOpenChoice(!open)}
          data-chat-aside-toggle
        >
          {open ? <PanelRightClose aria-hidden /> : <PanelRightOpen aria-hidden />}
          {label}
          {badge > 0 && (
            <span className="text-xs text-tier-3 tabular-nums" aria-label={`${badge} items`}>
              {badge}
            </span>
          )}
        </Button>,
        slot,
      )}
      {!phone && open && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label}`}
          aria-valuenow={width}
          aria-valuemin={MIN}
          aria-valuemax={maxWidth()}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className="w-1 shrink-0 cursor-col-resize touch-none bg-border/70 outline-none hover:bg-ring/40 focus-visible:bg-ring"
        />
      )}
      <aside
        aria-label={label}
        className={cn('min-h-0 min-w-0 flex-col overflow-hidden bg-background', shown ? 'flex' : 'hidden', phone ? 'flex-1' : 'shrink-0')}
        style={phone ? undefined : { width }}
        data-chat-aside
      >
        <LazyRegion loader={loader} props={region} name="aside" />
      </aside>
    </>
  )
}
