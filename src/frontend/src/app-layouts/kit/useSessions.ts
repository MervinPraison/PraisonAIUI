import { useSyncExternalStore } from 'react'
import { useLayoutData } from '@/sdk/layouts'
import type { SessionsFeed, SessionsState } from '@/sdk/layoutTypes'

const EMPTY: SessionsState = Object.freeze({ sessions: [], activeId: null, runningIds: new Set<string>(), loading: false })
const noSubscribe = () => () => {}
const empty = () => EMPTY

/** The `sessions` feed and its state, or null while nothing provides it (the chat built-in is off). */
export function useSessions(): { feed: SessionsFeed; state: SessionsState } | null {
  const feed = useLayoutData('sessions')
  const read = feed ? feed.get : empty
  const state = useSyncExternalStore(feed ? feed.subscribe : noSubscribe, read, read)
  return feed ? { feed, state } : null
}
