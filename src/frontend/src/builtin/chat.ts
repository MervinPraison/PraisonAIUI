/**
 * builtin.chat: the React chat page and its "New chat" command.
 *
 * registerChatPage() is `registerPage(id, () => import('@/chat-engine/ChatPage'))`
 * on the shared registry (the very function `sdk.registerPage` is), plus a
 * buffer for `aiui:prefill-composer` / `aiui:session-select` events that are
 * dispatched before the lazy chat chunk has loaded. Only that tiny module is
 * imported eagerly; the chat engine stays in its own chunk.
 */
import { Plus } from 'lucide-react'
import { registerChatPage } from '@/chat-engine/register'
import { whenPageShown } from './page'
import type { BuiltinPlugin, BuiltinSdk } from './types'

const CHAT_PAGE = 'chat'

/** Open chat on a fresh session: navigate, wait for the chat view to mount, then ask it to reset. */
export function startNewChat(sdk: Pick<BuiltinSdk, 'navigate' | 'getPageId'>, pageId = CHAT_PAGE): void {
  const fire = () => window.dispatchEvent(new CustomEvent('aiui:session-select', { detail: { sessionId: null } }))
  if (sdk.getPageId() === pageId) {
    fire()
    return
  }
  void whenPageShown(pageId, 5000).then(fire)
  sdk.navigate(pageId)
}

export const chatBuiltin: BuiltinPlugin = {
  name: 'builtin.chat',
  pages: [CHAT_PAGE],
  activate(sdk, { pageIds }) {
    for (const id of pageIds) registerChatPage(id)
    if (pageIds.includes(CHAT_PAGE)) {
      sdk.registerCommand({
        id: 'chat.new',
        title: 'New chat',
        group: 'Actions',
        keywords: ['session', 'conversation'],
        icon: Plus,
        run: () => startNewChat(sdk),
      })
    }
  },
}
