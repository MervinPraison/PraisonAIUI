/**
 * The frame's data: pending approvals (the `approvals` feed), the nav counts
 * (agents and runs today, from the `runs` feed: a provider's, else the
 * mission board's own over the run ledger, imported lazily) and the
 * provider health pill. Each hook works with its provider off.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useLayoutData } from '@/sdk/layouts'
import type { ApprovalItem, ApprovalsFeed, ChatState, Feed, RunsFeed } from '@/sdk/layoutTypes'
import { fetchJson } from '@/sdk/services'
import { healthOf, type HealthState } from './model'

const noop = () => () => {}

function useFeed<T>(feed: Feed<T> | null | undefined, fallback: T): T {
  const get = feed ? feed.get : () => fallback
  return useSyncExternalStore(feed ? feed.subscribe : noop, get, get)
}

const NO_PENDING: readonly ApprovalItem[] = Object.freeze([])

export function useApprovals(): { feed: ApprovalsFeed | null; pending: readonly ApprovalItem[] } {
  const feed = useLayoutData('approvals')
  const state = useFeed(feed, null)
  return { feed, pending: state?.pending ?? NO_PENDING }
}

const NO_CHAT: ChatState = Object.freeze({ sessionId: null, messages: [], isRunning: false })

export function useChatState(): { cancel?: () => Promise<void>; state: ChatState } {
  const feed = useLayoutData('chat')
  return { cancel: feed?.cancel, state: useFeed(feed, NO_CHAT) }
}

let fallbackRuns: Promise<RunsFeed | null> | null = null
const loadFallbackRuns = () =>
  (fallbackRuns ??= import('@/layout-features/mission-board/runsFeed')
    .then((m) => m.missionRuns() as RunsFeed)
    .catch((err: unknown) => {
      fallbackRuns = null
      console.warn('[aiui mission] the run feed failed to load', err)
      return null
    }))

/** The `runs` feed: a provider's, else the mission board's own (null until it loads). */
export function useRunsFeed(): RunsFeed | null {
  const provided = useLayoutData('runs')
  const [fallback, setFallback] = useState<RunsFeed | null>(null)
  useEffect(() => {
    if (provided) return
    let live = true
    void loadFallbackRuns().then((f) => {
      if (live) setFallback(f)
    })
    return () => {
      live = false
    }
  }, [provided])
  return provided ?? fallback
}

/** Agents and runs today for the nav (undefined while unknown). */
export function useRunCounts(runs: RunsFeed | null): { agents?: number; runs?: number } {
  const kpisFeed = useMemo(() => runs?.kpis('today') ?? null, [runs])
  const agentsFeed = useMemo(() => runs?.agents() ?? null, [runs])
  const kpis = useFeed(kpisFeed, null)
  const agents = useFeed(agentsFeed, null)
  return { agents: agents?.length || undefined, runs: kpis?.runs || undefined }
}

const HEALTH_MS = 30_000

/** The provider's health, read on mount and every 30 s while the tab is visible. */
export function useHealth(): { state: HealthState; label: string; agents?: number } {
  const [health, setHealth] = useState<{ state: HealthState; label: string; agents?: number }>({ state: 'unknown', label: 'Checking status' })
  useEffect(() => {
    let live = true
    const read = () => {
      if (document.visibilityState === 'hidden') return
      fetchJson('/api/provider/health')
        .then((body) => live && setHealth(healthOf(body)))
        .catch(() => live && setHealth({ state: 'unknown', label: 'Status unknown' }))
    }
    read()
    const t = setInterval(read, HEALTH_MS)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [])
  return health
}

/** Date.now(), every second while `active` (the banner's waiting timer). */
export function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}
