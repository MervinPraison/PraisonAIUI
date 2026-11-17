/**
 * builtin.layout-chat: the chat on its own, what `aiui run` opens. The Chat
 * and Canvas frame (same chunk, `layout-chat-canvas`) with no canvas aside
 * and no artifact cards: sessions in the frame, bubbles, approval cards,
 * and the same Paper look.
 * The frame skips the artifacts feed for this layout, so the artifacts
 * feature chunk never loads.
 */
import type { LayoutDescriptor } from './types'

export const CHAT_LAYOUT_ID = 'chat'

export const chatLayout: LayoutDescriptor = {
  id: CHAT_LAYOUT_ID,
  meta: {
    title: 'Chat',
    description: 'A clean chat with your chats in the sidebar, and no canvas.',
    chat: { sessions: 'frame', thread: 'bubbles', approvals: 'card' },
    // The same frame as Chat + Canvas, so the same look (styles/paper.css).
    look: 'paper',
  },
  load: () => import('@/app-layouts/chat-canvas/Frame'),
}
