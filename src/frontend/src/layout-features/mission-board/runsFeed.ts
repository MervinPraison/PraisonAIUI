/**
 * A `runs` feed over the run ledger's routes (builtin.run-ledger,
 * features/run_ledger.py): `GET /api/runs/kpis?window=`, `/api/runs/agents`,
 * `/api/runs?…` and `/api/runs/{id}`.
 *
 * Mission Control uses it when nothing provides the `runs` layout data kind
 * (`useLayoutData('runs')`): one shared instance per page (missionRuns()).
 * Each feed polls every 5 s while someone subscribes and the tab is visible,
 * refreshes when the tab comes back and on approval events, and stops
 * entirely on the last unsubscribe (a layout switch leaves nothing running).
 * A 404 means the ledger is not mounted (disabled, or no layout needs it):
 * `status` turns `off` and that feed stops polling; panels show an empty
 * state, never an error.
 */
import { fetchJson } from '@/sdk/services'
import type { AgentStatus, Feed, RunDetail, RunKpis, RunQuery, RunsFeed, RunSummary } from '@/sdk/layoutTypes'

export type RunsStatus = 'loading' | 'ok' | 'off' | 'error'

export interface MissionRunsFeed extends RunsFeed {
  /** Whether the run ledger answers: `off` when its routes are not mounted. */
  status: Feed<RunsStatus>
  /** Fetch every subscribed feed now (after a run or a decision). */
  refresh(): void
}

export interface RunsFeedOptions {
  fetch?: <T>(url: string) => Promise<T>
  pollMs?: number
  /** For tests: the document whose visibility gates polling (null: always visible). */
  doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> | null
  /** For tests: window events to refresh on. */
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null
}

/** Events after which counts change (approvals asked or decided). */
export const REFRESH_EVENTS = ['aiui:approval-required', 'aiui:approval-resolved'] as const

const statusOf = (err: unknown): number => (typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 0)

export function createRunsFeed({
  fetch = fetchJson,
  pollMs = 5000,
  doc = typeof document === 'undefined' ? null : document,
  win = typeof window === 'undefined' ? null : window,
}: RunsFeedOptions = {}): MissionRunsFeed {
  let status: RunsStatus = 'loading'
  const statusListeners = new Set<() => void>()
  const setStatus = (next: RunsStatus) => {
    if (next === status) return
    status = next
    for (const fn of [...statusListeners]) fn()
  }
  const statusFeed: Feed<RunsStatus> = {
    get: () => status,
    subscribe(fn) {
      statusListeners.add(fn)
      return () => statusListeners.delete(fn)
    },
  }

  interface Poller {
    feed: Feed<unknown>
    load(): void
  }
  const pollers = new Map<string, Poller>()
  const live = new Set<Poller>()
  let timer: ReturnType<typeof setInterval> | null = null
  const visible = () => !doc || doc.visibilityState !== 'hidden'

  const tick = () => {
    if (!visible()) return
    for (const p of live) p.load()
  }
  const onVisible = () => {
    if (visible()) tick()
  }
  const start = () => {
    timer = setInterval(tick, pollMs)
    doc?.addEventListener('visibilitychange', onVisible)
    for (const e of REFRESH_EVENTS) win?.addEventListener(e, tick)
  }
  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
    doc?.removeEventListener('visibilitychange', onVisible)
    for (const e of REFRESH_EVENTS) win?.removeEventListener(e, tick)
  }

  function poller<T>(key: string, url: string, pick: (body: unknown) => T, initial: T): Feed<T> {
    const existing = pollers.get(key)
    if (existing) return existing.feed as Feed<T>
    let value = initial
    let signature = JSON.stringify(initial)
    let inFlight = false
    let off = false
    const listeners = new Set<() => void>()
    const p: Poller = {
      feed: undefined as unknown as Feed<unknown>,
      load() {
        if (inFlight || off) return
        inFlight = true
        fetch<unknown>(url)
          .then((body) => {
            setStatus('ok')
            const next = pick(body)
            const sig = JSON.stringify(next)
            if (sig === signature) return
            signature = sig
            value = next
            for (const fn of [...listeners]) fn()
          })
          .catch((err: unknown) => {
            if (statusOf(err) === 404) {
              off = true
              setStatus('off')
            } else if (status !== 'ok') setStatus('error')
          })
          .finally(() => {
            inFlight = false
          })
      },
    }
    const feed: Feed<T> = {
      get: () => value,
      subscribe(fn) {
        listeners.add(fn)
        if (listeners.size === 1) {
          live.add(p)
          if (live.size === 1) start()
          p.load()
        }
        return () => {
          if (!listeners.delete(fn) || listeners.size) return
          live.delete(p)
          if (live.size === 0) stop()
        }
      },
    }
    p.feed = feed as Feed<unknown>
    pollers.set(key, p)
    return feed
  }

  const list = <T>(body: unknown, field: string): T[] => {
    const v = (body as Record<string, unknown> | null)?.[field]
    return Array.isArray(v) ? (v as T[]) : []
  }
  const obj = <T>(body: unknown): T | null => (body && typeof body === 'object' && !Array.isArray(body) ? (body as T) : null)

  return {
    status: statusFeed,
    refresh: tick,
    kpis: (window) => poller(`kpis:${window}`, `/api/runs/kpis?window=${encodeURIComponent(window)}`, (b) => obj<RunKpis>(b), null),
    agents: () => poller<readonly AgentStatus[]>('agents', '/api/runs/agents', (b) => list<AgentStatus>(b, 'agents'), []),
    recent(q: RunQuery = {}) {
      const params = new URLSearchParams()
      if (q.after) params.set('after', q.after)
      if (q.agent) params.set('agent', q.agent)
      params.set('limit', String(q.limit ?? 20))
      const qs = params.toString()
      return poller<readonly RunSummary[]>(`recent:${qs}`, `/api/runs?${qs}`, (b) => list<RunSummary>(b, 'runs'), [])
    },
    run: (id) => poller<RunDetail | null>(`run:${id}`, `/api/runs/${encodeURIComponent(id)}`, (b) => obj<RunDetail>(b), null),
  }
}

let shared: MissionRunsFeed | null = null

/** The page's one fallback feed (created on first use). */
export function missionRuns(): MissionRunsFeed {
  return (shared ??= createRunsFeed())
}

/** Whether `feed` reports the ledger's status (a provider's feed may not). */
export function hasStatus(feed: RunsFeed): feed is MissionRunsFeed {
  return typeof (feed as Partial<MissionRunsFeed>).status?.get === 'function'
}
