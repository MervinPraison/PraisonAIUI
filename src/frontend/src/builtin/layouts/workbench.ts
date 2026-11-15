/**
 * builtin.layout-workbench: the Quiet Workbench. A calm sidebar with the
 * chats, a top bar with the chat's agent and model, and the page beside it.
 *
 * Chat presentation: the frame draws the session list (`sessions: 'frame'`),
 * the thread is the `quiet` variant (the question in a quiet box, the answer
 * as plain prose with ghost tool rows) and approvals stay inline in it. The
 * frame (app-layouts/workbench) loads only while this layout is on screen.
 */
import type { LayoutDescriptor } from './types'

export const workbenchLayout: LayoutDescriptor = {
  id: 'workbench',
  meta: {
    title: 'Quiet Workbench',
    description: 'A calm sidebar with your chats, and a focused, quiet thread beside it.',
    chat: { sessions: 'frame', thread: 'quiet', approvals: 'inline' },
  },
  load: () => import('@/app-layouts/workbench/Frame'),
}
