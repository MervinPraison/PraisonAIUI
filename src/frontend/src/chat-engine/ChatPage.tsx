/**
 * CONTRACT STUB (WP0a). WP2 replaces this file with the assistant-ui chat page.
 * Contract (ADR-0001 §5):
 *   export default function ChatPage(p: { page: ShellPage }): JSX.Element
 */
import type { JSX } from 'react'
import type { ShellPage } from '../sdk/manifest'

export default function ChatPage({ page }: { page: ShellPage }): JSX.Element {
  return (
    <div data-aiui-stub="chat-page" data-page-id={page.id}>
      {page.title}
    </div>
  )
}
