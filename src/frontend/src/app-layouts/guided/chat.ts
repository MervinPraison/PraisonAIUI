/**
 * Guided's reads of the chat (over the `chat` and `sessions` layout feeds),
 * shared by the frame, the pages and the chat regions.
 */
import { useCallback, useSyncExternalStore } from 'react'
import { useLayoutData } from '@/sdk/layouts'
import type { ChatMessageView, ChatState, SessionSummary } from '@/sdk/layoutTypes'
import type { GuidedTemplate } from './templates'

const EMPTY_CHAT: ChatState = Object.freeze({ sessionId: null, messages: [], isRunning: false })
const noSubscribe = () => () => {}
const emptyChat = () => EMPTY_CHAT

/** The `chat` feed and its state, or a null feed and an empty state while nothing provides it. */
export function useChat() {
  const feed = useLayoutData('chat')
  const read = feed ? feed.get : emptyChat
  const state = useSyncExternalStore(feed ? feed.subscribe : noSubscribe, read, read)
  return { feed, state }
}

/** The agent the open chat is with: its last reply's agent, else the session's, else null. */
export function agentOf(state: ChatState, session?: SessionSummary): string | null {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i]
    if (m.role === 'assistant' && m.agentName) return m.agentName
  }
  return session?.agent ?? null
}

/** The follow-ups to offer under `messageId`: the last assistant turn's `suggestions`, once it is complete. */
export function followUpsFor(messages: readonly ChatMessageView[], messageId: string): string[] {
  let last: ChatMessageView | undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      last = messages[i]
      break
    }
  }
  if (!last || last.id !== messageId || last.status?.type !== 'complete') return []
  const raw = last.custom?.suggestions
  if (!Array.isArray(raw)) return []
  return raw.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim()).slice(0, 6)
}

/**
 * Start a chat from a template: a new chat (unless `inPlace`, for the
 * empty chat itself) with the prompt in its composer.
 */
export function useStartFromTemplate(inPlace = false): (t: GuidedTemplate) => void {
  const sessions = useLayoutData('sessions')
  const { feed } = useChat()
  return useCallback(
    (t: GuidedTemplate) => {
      if (!inPlace) sessions?.create()
      feed?.prefill(t.prompt)
    },
    [inPlace, sessions, feed],
  )
}
