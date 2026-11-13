/**
 * Pages ported to React. This is the ONLY list of ported pages: a page id
 * registered here renders its React component instead of the legacy view.
 * It grows as pages are ported (ADR-0001 §9, P1).
 */
import { registerChatPage } from '@/chat-engine/register'

let registered = false

export function registerPortedPages(): void {
  if (registered) return
  registered = true
  // Also buffers aiui:prefill-composer / aiui:session-select events that are
  // dispatched before the chat chunk has loaded.
  registerChatPage()
}
