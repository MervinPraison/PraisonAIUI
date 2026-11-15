/**
 * builtin.layout-chat-canvas: the app shell's default layout (chat with a
 * canvas of artifacts beside it). Stub descriptor: the frame is the kit's
 * BasicFrame until Track CC lands the real one with its chat presentation
 * (sessions 'frame', thread 'bubbles', approvals 'card', the canvas aside).
 */
import type { LayoutDescriptor } from './types'

export const chatCanvasLayout: LayoutDescriptor = {
  id: 'chat-canvas',
  meta: { title: 'Chat + Canvas', description: 'Chat beside a canvas of the artifacts the agent makes.' },
  load: () => import('@/app-layouts/chat-canvas/Frame'),
}
