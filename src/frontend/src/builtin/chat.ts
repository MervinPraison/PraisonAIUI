/**
 * builtin.chat: the React chat page.
 *
 * registerChatPage() is `registerPage(id, () => import('@/chat-engine/ChatPage'))`
 * on the shared registry (the very function `sdk.registerPage` is), plus a
 * buffer for `aiui:prefill-composer` / `aiui:session-select` events that are
 * dispatched before the lazy chat chunk has loaded. Only that tiny module is
 * imported eagerly; the chat engine stays in its own chunk.
 */
import { registerChatPage } from '@/chat-engine/register'
import type { BuiltinPlugin } from './types'

export const chatBuiltin: BuiltinPlugin = {
  name: 'builtin.chat',
  pages: ['chat'],
  activate() {
    for (const id of this.pages) registerChatPage(id)
  },
}
