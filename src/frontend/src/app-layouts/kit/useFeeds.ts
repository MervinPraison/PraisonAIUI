import { useSyncExternalStore } from 'react'
import { useLayoutData } from '@/sdk/layouts'
import type { ApprovalsFeed, ApprovalsState, ChatFeed, ChatState, Feed } from '@/sdk/layoutTypes'

const noSubscribe = () => () => {}

/** A feed's state, or `fallback` while nothing provides the feed. */
function useFeedState<S>(feed: Feed<S> | null, fallback: S): S {
  const read = feed ? feed.get : () => fallback
  return useSyncExternalStore(feed ? feed.subscribe : noSubscribe, read, read)
}

const NO_CHAT: ChatState = Object.freeze({ sessionId: null, messages: [], isRunning: false })
const NO_APPROVALS: ApprovalsState = Object.freeze({ pending: [] })

/** The open chat (`chat` feed) and its state, or null while the chat built-in is off. */
export function useChat(): { feed: ChatFeed; state: ChatState } | null {
  const feed = useLayoutData('chat')
  const state = useFeedState(feed, NO_CHAT)
  return feed ? { feed, state } : null
}

/** Pending approvals (`approvals` feed), or null while builtin.approvals is off. */
export function useApprovals(): { feed: ApprovalsFeed; state: ApprovalsState } | null {
  const feed = useLayoutData('approvals')
  const state = useFeedState(feed, NO_APPROVALS)
  return feed ? { feed, state } : null
}
