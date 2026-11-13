/**
 * Shell hook-up for the React chat page. The shell imports this tiny module
 * eagerly; the page itself (assistant-ui, the engine, the thread) stays in a
 * lazy chunk:
 *
 *   import { registerChatPage } from '@/chat-engine/register'
 *   registerChatPage()            // == registerPage('chat', () => import('@/chat-engine/ChatPage'))
 *
 * It also buffers the last `aiui:prefill-composer` text and
 * `aiui:session-select` id. Other pages dispatch those right after navigating
 * to chat (code-studio "Send to agent", the session search palette, jobs),
 * which is before the lazy chat chunk has loaded and started listening.
 */
import { registerPage } from '@/sdk/registry'

/** A buffered event older than this is not replayed (the user went elsewhere). */
const BUFFER_TTL_MS = 30_000

type Buffered = { value: string; at: number }
let pendingPrefill: Buffered | null = null
let pendingSession: Buffered | null = null
let installed = false

function detailString(e: Event, key: 'text' | 'sessionId'): string | null {
  const v = ((e as CustomEvent<Record<string, unknown> | undefined>).detail ?? {})[key]
  return typeof v === 'string' && v ? v : null
}

function onPrefill(e: Event) {
  const text = detailString(e, 'text')
  if (text) pendingPrefill = { value: text, at: Date.now() }
}

function onSessionSelect(e: Event) {
  const id = detailString(e, 'sessionId')
  if (id) pendingSession = { value: id, at: Date.now() }
}

function take(b: Buffered | null): string | null {
  return b && Date.now() - b.at <= BUFFER_TTL_MS ? b.value : null
}

/** Register the React chat page under `id` (default 'chat'). Idempotent. */
export function registerChatPage(id = 'chat'): void {
  registerPage(id, () => import('./ChatPage'))
  if (!installed && typeof window !== 'undefined') {
    installed = true
    window.addEventListener('aiui:prefill-composer', onPrefill)
    window.addEventListener('aiui:session-select', onSessionSelect)
  }
}

/** Take (and clear) a prefill that arrived before the chat page could handle it. */
export function takePendingPrefill(): string | null {
  const t = take(pendingPrefill)
  pendingPrefill = null
  return t
}

/** Take (and clear) a session selection that arrived before the chat page could handle it. */
export function takePendingSessionSelect(): string | null {
  const t = take(pendingSession)
  pendingSession = null
  return t
}
