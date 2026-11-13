/**
 * Pages ported to React. This is the ONLY list of ported pages: a page id
 * registered here renders its React component instead of the legacy view.
 * It grows as pages are ported (ADR-0001 §9, P1).
 */
import { registerPage } from '@/sdk/registry'

let registered = false

export function registerPortedPages(): void {
  if (registered) return
  registered = true
  registerPage('chat', () => import('@/chat-engine/ChatPage'))
}
