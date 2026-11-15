/**
 * builtin.layout-workbench: a quiet sidebar with chats, a top bar, the page.
 * Stub descriptor: Track W lands the real frame and its chat presentation
 * (sessions 'frame', thread 'quiet', approvals 'inline').
 */
import type { LayoutDescriptor } from './types'

export const workbenchLayout: LayoutDescriptor = {
  id: 'workbench',
  meta: { title: 'Quiet Workbench', description: 'A quiet sidebar with your chats, and the page beside it.' },
  load: () => import('@/app-layouts/workbench/Frame'),
}
