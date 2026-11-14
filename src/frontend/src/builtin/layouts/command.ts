/**
 * builtin.layout-command: keyboard-first (icon rail, command bar, session
 * tabs, run inspector). Stub descriptor: Track K lands the real frame and its
 * chat presentation (sessions 'tabs', thread 'dense', approvals 'keyboard').
 */
import type { LayoutDescriptor } from './types'

export const commandLayout: LayoutDescriptor = {
  id: 'command',
  meta: { title: 'Command Deck', description: 'Keyboard first: a command bar, session tabs and a run inspector.' },
  load: () => import('@/app-layouts/command/Frame'),
}
