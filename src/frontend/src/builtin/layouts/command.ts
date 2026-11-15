/**
 * builtin.layout-command: the Command Deck (ADR 0003 track K). Keyboard
 * first: an icon rail with G-prefix keys, a command bar, session tabs
 * (⌘1–9), a run inspector (⌘I) and a status bar.
 *
 * The chat page draws no session rail (the frame's tabs are the list), uses
 * the dense thread and the A / D approval strip; the frame shows pending
 * approvals itself, so builtin.approvals raises no toast. Only this
 * descriptor is eager: the frame and its features (lf-command-bar,
 * lf-run-inspector) load when the layout is rendered.
 */
import type { LayoutDescriptor } from './types'

export const commandLayout: LayoutDescriptor = {
  id: 'command',
  meta: {
    title: 'Command Deck',
    description: 'Keyboard first: a command bar, session tabs and a run inspector.',
    chat: { sessions: 'tabs', thread: 'dense', approvals: 'keyboard' },
    approvals: 'frame',
  },
  load: () => import('@/app-layouts/command/Frame'),
}
