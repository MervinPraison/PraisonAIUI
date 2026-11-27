/**
 * builtin.chat: the React chat page, its "New chat" command, and the
 * `sessions` and `chat` layout data feeds (ADR 0003 §1.1).
 *
 * registerChatPage() is `registerPage(id, () => import('@/chat-engine/ChatPage'))`
 * on the shared registry (the very function `sdk.registerPage` is), plus a
 * buffer for `aiui:prefill-composer` / `aiui:session-select` events that are
 * dispatched before the lazy chat chunk has loaded. Only that tiny module is
 * imported eagerly; the chat engine stays in its own chunk. The feeds are
 * provided as loaders of `@/chat-engine/feeds` (no assistant-ui), which runs
 * only when a layout frame first reads one.
 */
import { lazy } from 'react'
import { Plus } from 'lucide-react'
import { registerChatPage } from '@/chat-engine/register'
import { whenPageShown } from './page'
import type { BuiltinPlugin, BuiltinSdk } from './types'

const ChatPanelBlockLazy = lazy(() => import('@/chat-engine/ChatPanelBlock'))

const CHAT_PAGE = 'chat'
/**
 * The catalog's "Chat + Canvas" page (same record, builtin.chat). Its vanilla
 * view is the dashboard's; in the app shell it is the React chat, which
 * shows the canvas beside the thread wherever the layout provides one.
 */
const CHAT_CANVAS_PAGE = 'chat-canvas'

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

/** Open the chat page unless it is on screen (a frame picked a session or prefilled the composer). */
export function showChat(sdk: Pick<BuiltinSdk, 'navigate' | 'getPageId'>, pageId = CHAT_PAGE): void {
  if (sdk.getPageId() !== pageId) sdk.navigate(pageId)
}

/** Provide `sessions` and `chat` to layout frames, lazily. Returns the removers. */
export function provideChatFeeds(sdk: Pick<BuiltinSdk, 'navigate' | 'getPageId' | 'provideLayoutData'>): (() => void)[] {
  const show = () => showChat(sdk)
  const feeds = () => import('@/chat-engine/feeds')
  return [
    sdk.provideLayoutData('sessions', () => feeds().then((m) => m.createSessionsFeed({ show }))),
    sdk.provideLayoutData('chat', () => feeds().then((m) => m.createChatFeed({ show }))),
  ]
}

export const chatBuiltin: BuiltinPlugin = {
  name: 'builtin.chat',
  pages: [CHAT_PAGE, CHAT_CANVAS_PAGE],
  activate(sdk, { pageIds }) {
    for (const id of pageIds) registerChatPage(id)
    sdk.registerBlock('chat_panel', ChatPanelBlockLazy, { fallback: true })
    if (pageIds.includes(CHAT_PAGE)) {
      sdk.registerCommand({
        id: 'chat.new',
        title: 'New chat',
        group: 'Actions',
        keywords: ['session', 'conversation'],
        icon: Plus,
        run: () => startNewChat(sdk),
      })
      provideChatFeeds(sdk)
    }
  },
}
