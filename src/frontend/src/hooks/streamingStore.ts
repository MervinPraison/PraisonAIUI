/**
 * streamingStore.ts — Module-level session-keyed streaming store.
 *
 * Keeps one SSE fetch per session independent of React component lifecycle.
 * ChatArea subscribes to its own session slice; switching sessions never
 * affects another session's in-flight stream.
 */

import type { ToolCall } from '../types'

// ---------------------------------------------------------------------------
// State shape per session
// ---------------------------------------------------------------------------

export interface SessionStreamState {
  isStreaming: boolean
  currentResponse: string
  toolCalls: ToolCall[]
  thinkingSteps: string[]
}

const defaultState = (): SessionStreamState => ({
  isStreaming: false,
  currentResponse: '',
  toolCalls: [],
  thinkingSteps: [],
})

// ---------------------------------------------------------------------------
// Internal store: Map<sessionId, state + listeners + abort>
// ---------------------------------------------------------------------------

interface StoreEntry {
  state: SessionStreamState
  listeners: Set<() => void>
  abortController: AbortController | null
  toolCallMap: Map<string, ToolCall>  // persists across events in a stream
}

const store = new Map<string, StoreEntry>()

function getEntry(sessionId: string): StoreEntry {
  if (!store.has(sessionId)) {
    store.set(sessionId, {
      state: defaultState(),
      listeners: new Set(),
      abortController: null,
      toolCallMap: new Map(),
    })
  }
  return store.get(sessionId)!
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get a snapshot of the current state for sessionId. */
export function getSessionState(sessionId: string | null | undefined): SessionStreamState {
  if (!sessionId) return defaultState()
  return getEntry(sessionId).state
}

/** Subscribe to state changes for a specific session. Returns unsubscribe fn. */
export function subscribeToSession(sessionId: string, listener: () => void): () => void {
  const entry = getEntry(sessionId)
  entry.listeners.add(listener)
  return () => entry.listeners.delete(listener)
}

/** Patch and notify listeners. */
function update(sessionId: string, patch: Partial<SessionStreamState>) {
  const entry = getEntry(sessionId)
  entry.state = { ...entry.state, ...patch }
  entry.listeners.forEach((l) => l())
}

// ---------------------------------------------------------------------------
// Stream lifecycle
// ---------------------------------------------------------------------------

/** Cancel any running stream for sessionId (client + server). */
export async function cancelStream(sessionId: string): Promise<void> {
  const entry = store.get(sessionId)
  if (!entry) return
  entry.abortController?.abort()
  entry.abortController = null
  update(sessionId, { isStreaming: false })
  try {
    await fetch('/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId }),
    })
  } catch {
    // best-effort
  }
}

/** Start a streaming request for sessionId. If one is already running, no-op. */
export function startStream(
  sessionId: string,
  message: string,
  agentName?: string,
  callbacks?: {
    onSessionId?: (id: string) => void
    onEnd?: () => void
  },
): void {
  const entry = getEntry(sessionId)

  // If already streaming in this session, ignore
  if (entry.state.isStreaming) return

  // Reset streaming UI state for this session
  update(sessionId, {
    isStreaming: true,
    currentResponse: '',
    toolCalls: [],
    thinkingSteps: [],
  })
  // Reset tool call dedup map for this new stream
  entry.toolCallMap = new Map()

  const ac = new AbortController()
  entry.abortController = ac

  // Run async without awaiting — stream lives independently of component
  void runStream(sessionId, message, agentName, ac, callbacks)
}

async function runStream(
  sessionId: string,
  message: string,
  agentName: string | undefined,
  ac: AbortController,
  callbacks?: {
    onSessionId?: (id: string) => void
    onEnd?: () => void
  },
): Promise<void> {
  try {
    const response = await fetch('/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, session_id: sessionId, agent: agentName }),
      signal: ac.signal,
    })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const event = JSON.parse(line.slice(6))
          handleStoreEvent(sessionId, event, callbacks)
        } catch {
          // ignore parse errors
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      // Surface error as a thinking step; ChatArea will see it
      const entry = store.get(sessionId)
      if (entry) {
        update(sessionId, {
          thinkingSteps: [...entry.state.thinkingSteps, `Error: ${(err as Error).message}`],
        })
      }
    }
  } finally {
    const entry = store.get(sessionId)
    if (entry) {
      entry.abortController = null
    }
    update(sessionId, { isStreaming: false })
    callbacks?.onEnd?.()
  }
}

function handleStoreEvent(
  sessionId: string,
  event: Record<string, unknown>,
  callbacks?: { onSessionId?: (id: string) => void; onEnd?: () => void },
) {
  const entry = store.get(sessionId)
  if (!entry) return
  const toolCallMap = entry.toolCallMap

  const type = event.type as string

  switch (type) {
    case 'session':
      if (event.session_id && typeof event.session_id === 'string') {
        callbacks?.onSessionId?.(event.session_id)
      }
      break

    case 'token':
    case 'run_content':
    case 'team_run_content': {
      const tok = (event.token ?? event.content ?? '') as string
      if (tok) update(sessionId, { currentResponse: entry.state.currentResponse + tok })
      break
    }

    case 'message':
    case 'run_completed':
    case 'team_run_completed': {
      const content = event.content as string | undefined
      if (content) {
        // Final response replaces accumulated tokens
        update(sessionId, { currentResponse: content })
      }
      break
    }

    case 'thinking':
    case 'reasoning_step':
    case 'team_reasoning_step': {
      const step = event.step as string | undefined
      if (step) update(sessionId, { thinkingSteps: [...entry.state.thinkingSteps, step] })
      break
    }

    case 'reasoning_started':
    case 'team_reasoning_started':
      update(sessionId, { thinkingSteps: [...entry.state.thinkingSteps, 'Starting reasoning...'] })
      break

    case 'tool_call':
    case 'tool_call_started':
    case 'team_tool_call_started': {
      const tc: ToolCall = {
        name: event.name as string,
        description: event.description as string | undefined,
        icon: event.icon as string | undefined,
        step_number: event.step_number as number | undefined,
        status: 'running',
        tool_call_id: event.tool_call_id as string | undefined,
        args: event.args as Record<string, unknown> | undefined,
      }
      if (tc.tool_call_id) toolCallMap.set(tc.tool_call_id, tc)
      const all = buildToolCallList(entry.state.toolCalls, tc)
      update(sessionId, { toolCalls: all })
      break
    }

    case 'tool_call_completed':
    case 'team_tool_call_completed': {
      const tc: ToolCall = {
        name: event.name as string,
        description: event.description as string | undefined,
        icon: event.icon as string | undefined,
        step_number: event.step_number as number | undefined,
        status: 'done',
        tool_call_id: event.tool_call_id as string | undefined,
        args: event.args as Record<string, unknown> | undefined,
        formatted_result: event.formatted_result as string | undefined,
        result: event.result,
      }
      if (tc.tool_call_id) toolCallMap.set(tc.tool_call_id, tc)
      const all = buildToolCallList(entry.state.toolCalls, tc)
      update(sessionId, { toolCalls: all })
      break
    }

    case 'error':
    case 'run_error':
    case 'team_run_error': {
      const errMsg = event.error as string | undefined
      if (errMsg) {
        update(sessionId, {
          thinkingSteps: [...entry.state.thinkingSteps, `Error: ${errMsg}`],
        })
      }
      break
    }

    case 'end':
    case 'done':
    case 'run_cancelled':
    case 'team_run_cancelled':
      // finalize current response as a committed message is done by onEnd
      break
  }
}

function buildToolCallList(
  existing: ToolCall[],
  incoming: ToolCall,
): ToolCall[] {
  if (incoming.tool_call_id) {
    // Upsert: replace if already exists, else append
    const idx = existing.findIndex((tc) => tc.tool_call_id === incoming.tool_call_id)
    if (idx >= 0) {
      const next = [...existing]
      next[idx] = { ...next[idx], ...incoming }
      return next
    }
  }
  return [...existing, incoming]
}
