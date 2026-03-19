/**
 * useSSE.ts — React hook that subscribes to the session-keyed streaming store.
 *
 * Each session has its own isolated stream. Switching sessions never touches
 * another session's in-flight fetch.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  cancelStream,
  getSessionState,
  startStream,
  subscribeToSession,
} from './streamingStore'

interface UseSSEOptions {
  externalSessionId?: string | null
  onSessionId?: (sessionId: string) => void
  onEnd?: () => void
}

interface UseSSEReturn {
  isStreaming: boolean
  sendMessage: (message: string, agentName?: string) => void
  cancel: () => void
  // Expose store state so ChatArea can read it
  currentResponse: string
  toolCalls: import('../types').ToolCall[]
  thinkingSteps: string[]
}

export function useSSE(options: UseSSEOptions = {}): UseSSEReturn {
  const { externalSessionId } = options

  // Snapshot of the current session's stream state
  const [snap, setSnap] = useState(() => getSessionState(externalSessionId))

  // Re-subscribe whenever the session changes
  useEffect(() => {
    if (!externalSessionId) {
      setSnap(getSessionState(null))
      return
    }
    // Immediately read any existing state (handles back-navigation to streaming session)
    setSnap(getSessionState(externalSessionId))
    // Subscribe to future updates
    return subscribeToSession(externalSessionId, () => {
      setSnap(getSessionState(externalSessionId))
    })
  }, [externalSessionId])

  const sendMessage = useCallback(
    (message: string, agentName?: string) => {
      if (!externalSessionId) return
      startStream(externalSessionId, message, agentName, {
        onSessionId: options.onSessionId,
        onEnd: options.onEnd,
      })
    },
    [externalSessionId, options.onSessionId, options.onEnd],
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
    sendMessage,
    cancel,
  }
}
