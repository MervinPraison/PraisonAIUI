/**
 * builtin.layout-guided: plain language, big targets, a step tracker.
 * Stub descriptor: Track G lands the real frame, its `start` and `templates`
 * pages and its chat presentation (thread 'steps', approvals 'card').
 */
import type { LayoutDescriptor } from './types'

export const guidedLayout: LayoutDescriptor = {
  id: 'guided',
  meta: { title: 'Guided Studio', description: 'Plain language and large buttons; every step explained.' },
  load: () => import('@/app-layouts/guided/Frame'),
}
