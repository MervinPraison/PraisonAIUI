/**
 * Shared pieces of the app shell's React pages (src/app-pages): the
 * classic-frame fallback, relative times, a polled JSON read and the small
 * status and tile pieces the pages draw in the PraisonAI Pro tokens.
 *
 * The app pages replace a legacy vanilla view while a layout frame is on
 * screen. In the classic frame (`layout: classic`, or no layout) the page
 * renders the legacy view exactly as before, so the classic frame keeps
 * its look; the default `dashboard` style never loads this code (R6).
 */
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useLayout } from '@/sdk/layouts'
import type { ShellPage } from '@/sdk/manifest'
import { fetchJson } from '@/sdk/services'
import './app-pages.css'

export interface AppPageProps {
  page: ShellPage
}

// The same lazy chunk the shell's PageView loads for legacy pages: imported
// statically here it would regroup that chunk's modules (and their icons)
// into chunks of their own on the chat route's path.
const LegacyViewHost = lazy(() => import('@/legacy/LegacyViewHost').then((m) => ({ default: m.LegacyViewHost })))

/** The React page inside a layout frame, the legacy view in the classic frame. */
export function inLayoutOnly(Page: ComponentType<AppPageProps>): ComponentType<AppPageProps> {
  function AppPage({ page }: AppPageProps) {
    const layout = useLayout()
    if (!layout) {
      return (
        <Suspense fallback={null}>
          <LegacyViewHost pageId={page.id} page={page} />
        </Suspense>
      )
    }
    return <Page page={page} />
  }
  AppPage.displayName = `AppPage(${Page.displayName ?? Page.name ?? 'page'})`
  return AppPage
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Epoch ms from an ISO string, epoch seconds or epoch ms; NaN when unknown. */
export function toMs(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string' && v) return Date.parse(v)
  return Number.NaN
}

/** "just now", "9 min ago", "3 h ago", "yesterday", "Mar 4" */
export function ago(at: number, now = Date.now()): string {
  if (!Number.isFinite(at)) return ''
  const d = now - at
  if (d < MINUTE) return 'just now'
  if (d < HOUR) return `${Math.floor(d / MINUTE)} min ago`
  if (d < DAY) return `${Math.floor(d / HOUR)} h ago`
  if (d < 2 * DAY) return 'yesterday'
  const date = new Date(at)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The full date and time, for a title attribute. */
export function fullTime(at: number): string {
  return Number.isFinite(at) ? new Date(at).toLocaleString() : ''
}

/** Re-render every `ms` (relative times stay true). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}

export interface JsonState<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload(): void
}

/**
 * GET `url` as JSON; again every `everyMs` while the tab is visible (0:
 * once). `null` url: nothing is fetched. A failed read keeps the last data.
 */
export function useJson<T>(url: string | null, everyMs = 0): JsonState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(url !== null)
  const [tick, setTick] = useState(0)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    if (!url) return
    let live = true
    const read = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      fetchJson<T>(url).then(
        (d) => {
          if (!live) return
          setData(d)
          setError(null)
          setLoading(false)
        },
        (e: unknown) => {
          if (!live) return
          setError(e instanceof Error ? e.message : String(e))
          setLoading(false)
        },
      )
    }
    read()
    const id = everyMs > 0 ? window.setInterval(read, everyMs) : 0
    return () => {
      live = false
      if (id) window.clearInterval(id)
    }
  }, [url, everyMs, tick])
  return { data, error, loading, reload: () => alive.current && setTick((t) => t + 1) }
}

export type Tone = 'ok' | 'warn' | 'bad' | 'idle' | 'info'

const DOT: Record<Tone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
  idle: 'bg-muted-foreground/50',
  info: 'bg-info',
}

/** A 6px dot and a 12px muted label: how every app page says a status. */
export function StatusDot({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground', className)}>
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT[tone])} />
      <span className="truncate">{children}</span>
    </span>
  )
}

const PILL: Record<Tone, string> = {
  ok: 'bg-success-soft text-success',
  warn: 'bg-warning-soft text-warning',
  bad: 'bg-danger-soft text-destructive',
  idle: 'bg-muted text-muted-foreground',
  info: 'bg-info-soft text-info',
}

/** A status pill (Running, Idle, Failed…). */
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cn('inline-flex h-5 shrink-0 items-center rounded-full px-2 text-2xs font-medium whitespace-nowrap', PILL[tone])}>{children}</span>
}

/** A titled card section of a page. */
export function Section({
  title,
  meta,
  action,
  children,
  className,
}: {
  title: string
  meta?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section aria-label={title} className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex min-h-7 items-center gap-2">
        <h2 className="m-0 text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {meta && <span className="min-w-0 truncate text-xs text-tier-3">{meta}</span>}
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  )
}

/** Page body: the reading width and the Pro page padding. */
export function PageBody({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn('mx-auto flex w-full min-w-0 flex-col gap-6 px-4 py-5 sm:px-6 sm:py-6', wide ? 'max-w-[1200px]' : 'max-w-[1040px]', className)}>{children}</div>
}
