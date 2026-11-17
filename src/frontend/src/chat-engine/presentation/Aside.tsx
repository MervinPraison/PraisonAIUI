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

/**
 * Dispatched on window to show or hide the aside: `{open: true}` (a phone
 * flips to the aside's side), `{open: false}`. The artifacts feature sends
 * `{open: true}` when a card opens an artifact.
 */
export const ASIDE_EVENT = 'aiui:chat-aside'

/**
 * Open, the aside is the page's main surface (Canvas.dc.html: the canvas
 * takes ~58% of the chat page, the thread a narrower column). Its share is
 * kept per browser; the thread never gets less than MIN_THREAD px (its
 * column, the gap and the aside's margins) and the aside never less than
 * MIN_ASIDE px while there is room.
 */
const RATIO_KEY = 'aiui-chat-aside-ratio'
const DEFAULT_RATIO = 0.58
const MIN_ASIDE = 320
const MIN_THREAD = 420
const STEP = 0.02

/** The share of `total` px the aside may take: the thread keeps MIN_THREAD, the aside MIN_ASIDE while it fits. */
// eslint-disable-next-line react-refresh/only-export-components -- pure, shared with tests
export function ratioBounds(total: number): { min: number; max: number } {
  if (!(total > 0)) return { min: 0.2, max: 0.8 }
  const max = Math.max(0, Math.min(0.8, (total - MIN_THREAD) / total))
  return { min: Math.min(MIN_ASIDE / total, max), max }
}

// eslint-disable-next-line react-refresh/only-export-components -- pure, shared with tests
export function clampRatio(r: number, total = 0): number {
  const { min, max } = ratioBounds(total)
  return Math.min(Math.max(r, min), max)
}

function readRatio(): number {
  try {
    const v = Number(localStorage.getItem(RATIO_KEY))
    return v > 0 && v < 1 ? v : DEFAULT_RATIO
  } catch {
    return DEFAULT_RATIO
  }
}

function writeRatio(r: number) {
  try {
    localStorage.setItem(RATIO_KEY, r.toFixed(3))
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
  const [ratio, setRatio] = useState(readRatio)
  const drag = useRef<{ x: number; r: number; total: number } | null>(null)

  const commit = useCallback((r: number, total: number) => {
    const next = clampRatio(r, total)
    setRatio(next)
    writeRatio(next)
  }, [])

  // A card asks for the aside (`{open: true}`): open it, or on a phone show its side; `{open: false}` hides it.
  useEffect(() => {
    const onAside = (e: Event) => {
      const want = (e as CustomEvent<{ open?: unknown }>).detail?.open !== false
      if (phone) setTab(want ? 'aside' : 'chat')
      else setOpenChoice(want)
    }
    window.addEventListener(ASIDE_EVENT, onAside)
    return () => window.removeEventListener(ASIDE_EVENT, onAside)
  }, [phone])

  const total = (el: Element) => el.parentElement?.getBoundingClientRect().width ?? 0
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: e.clientX, r: ratio, total: total(e.currentTarget) }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    // The panel is on the right: dragging left widens it.
    const d = drag.current
    if (d && d.total > 0) setRatio(clampRatio(d.r + (d.x - e.clientX) / d.total, d.total))
  }
  const onPointerUp = () => {
    if (!drag.current) return
    const { total: t } = drag.current
    drag.current = null
    commit(ratio, t)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = total(e.currentTarget)
    const { min, max } = ratioBounds(t)
    const delta = e.key === 'ArrowLeft' ? STEP : e.key === 'ArrowRight' ? -STEP : 0
    if (e.key === 'Home') commit(max, t)
    else if (e.key === 'End') commit(min, t)
    else if (delta) commit(clampRatio(ratio, t) + delta, t)
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
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`${label} ${Math.round(ratio * 100)}% of the page`}
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
        style={phone ? undefined : { flexBasis: `${(ratio * 100).toFixed(1)}%`, minWidth: `min(${MIN_ASIDE}px, max(0px, 100% - ${MIN_THREAD}px))`, maxWidth: `max(0px, 100% - ${MIN_THREAD}px)` }}
        data-chat-aside
      >
        <LazyRegion loader={loader} props={region} name="aside" />
      </aside>
    </>
  )
}
