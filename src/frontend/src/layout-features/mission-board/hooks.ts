/**
 * Data hooks of the mission board: the layout data feeds (runs, approvals,
 * sessions, chat) as React state. Every hook works with its provider off
 * (null feed): it returns an empty value, so a panel shows an empty state.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useLayoutData } from '@/sdk/layouts'
import type { ApprovalItem, ApprovalsFeed, ChatFeed, ChatState, Feed, RunsFeed } from '@/sdk/layoutTypes'
import { hasStatus, missionRuns, type RunsStatus } from './runsFeed'

const noop = () => () => {}

/** The value of a feed (or `fallback` while there is none). */
export function useFeed<T>(feed: Feed<T> | null | undefined, fallback: T): T {
  const get = feed ? feed.get : () => fallback
  return useSyncExternalStore(feed ? feed.subscribe : noop, get, get)
}

/** The `runs` feed: a provider's when one is on, else the board's own over the ledger routes. */
export function useRuns(): RunsFeed {
  return useLayoutData('runs') ?? missionRuns()
}

const OK_STATUS: Feed<RunsStatus> = { get: () => 'ok', subscribe: noop }

/** `off` when the run ledger is not mounted; a provider's feed always counts as `ok`. */
export function useRunsStatus(feed: RunsFeed): RunsStatus {
  return useFeed(hasStatus(feed) ? feed.status : OK_STATUS, 'ok')
}

const NO_PENDING: readonly ApprovalItem[] = Object.freeze([])

export function useApprovals(): { feed: ApprovalsFeed | null; pending: readonly ApprovalItem[] } {
  const feed = useLayoutData('approvals')
  const state = useFeed(feed, null)
  return { feed, pending: state?.pending ?? NO_PENDING }
}

const NO_CHAT: ChatState = Object.freeze({ sessionId: null, messages: [], isRunning: false })

export function useChat(): { feed: ChatFeed | null; state: ChatState } {
  const feed = useLayoutData('chat')
  return { feed, state: useFeed(feed, NO_CHAT) }
}

/**
 * Date.now(), re-read every second while `active` (live timers) and every
 * 30 s otherwise ("38m ago"); one interval per caller, cleared on unmount.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), active ? 1000 : 30_000)
    return () => clearInterval(t)
  }, [active])
  return now
}
