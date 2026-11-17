/**
 * useSSE.ts — React hook that subscribes to the session-keyed streaming store.
 *
 * Each session has its own isolated stream. Switching sessions never touches
 * another session's in-flight fetch.
 */

import { useCallback, useSyncExternalStore } from 'react'
import {
  cancelStream,
  getSessionState,
  startStream,
  subscribeToSession,
} from './streamingStore'

interface UseSSEOptions {
  externalSessionId?: string | null
  onSessionId?: (sessionId: string) => void
  /** Called when a stream ends, with the session id it ended for (the server's id when it sent one). */
  onEnd?: (sessionId: string) => void
}

interface UseSSEReturn {
  isStreaming: boolean
  sendMessage: (message: string, agentName?: string) => void
  cancel: () => void
  // Expose store state so ChatArea can read it
  currentResponse: string
  toolCalls: import('../types').ToolCall[]
  thinkingSteps: string[]
  pendingElements: (import('../types').MessageElementUnion | Record<string, unknown>)[]
}

/** The snapshot while no session is open: one object, so the store read is stable. */
const NO_SESSION = getSessionState(null)
const unsubscribeNothing = () => {}

export function useSSE(options: UseSSEOptions = {}): UseSSEReturn {
  const { externalSessionId, onSessionId, onEnd } = options

  // The current session's stream state, re-subscribed whenever the session
  // changes (a back-navigation reads that session's in-flight state at once).
  const subscribe = useCallback(
    (onChange: () => void) => (externalSessionId ? subscribeToSession(externalSessionId, onChange) : unsubscribeNothing),
    [externalSessionId],
  )
  const snap = useSyncExternalStore(subscribe, () => (externalSessionId ? getSessionState(externalSessionId) : NO_SESSION))

  const sendMessage = useCallback(
    (message: string, agentName?: string) => {
      // Allow null session ID — server will create a new session and return it
      // via the 'session' SSE event. Use a temp key until then.
      const sid = externalSessionId ?? `new-${Date.now()}`
      // The callbacks outlive this render: report the id the stream resolved to,
      // not the one captured here (null for a new conversation).
      let resolvedId = sid
      startStream(sid, message, agentName, {
        onSessionId: (newId) => {
          // The server returned a real session ID. Notify parent.
          resolvedId = newId
          onSessionId?.(newId)
        },
        onEnd: () => onEnd?.(resolvedId),
      })
    },
    [externalSessionId, onSessionId, onEnd],
  )

  const cancel = useCallback(() => {
    if (!externalSessionId) return
    void cancelStream(externalSessionId)
  }, [externalSessionId])

  return {
    isStreaming: snap.isStreaming,
    currentResponse: snap.currentResponse,
    toolCalls: snap.toolCalls,
    thinkingSteps: snap.thinkingSteps,
    pendingElements: snap.pendingElements,
    sendMessage,
    cancel,
  }
}
