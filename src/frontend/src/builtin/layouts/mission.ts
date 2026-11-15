/**
 * builtin.layout-mission: Mission Control, an operations view (agents, runs,
 * approvals and spend at a glance; Mission.dc.html, MissionPhone.dc.html).
 *
 *   frame       app-layouts/mission (chunk layout-mission): top bar, nav
 *               with counts, the approval banner, the ops column beside the
 *               chat, phone tabs
 *   board       layout-features/mission-board (chunk lf-mission-board): KPI
 *               strip, agent cards, the ops overview, the run feed and the
 *               run timeline; loaded with import() only when shown
 *   approvals   'frame': builtin.approvals stops toasting while Mission is on
 *               screen, because the frame shows every pending approval
 *               (banner, bell, nav badge, agent card, overview cards)
 *   chat        the frame draws the sessions (ops column); dense thread;
 *               approval cards in the thread; the run timeline above each
 *               answer (turnHeader)
 *
 * Eager and tiny: nothing here downloads until Mission is on screen.
 */
import type { LayoutDescriptor } from './types'

export const missionLayout: LayoutDescriptor = {
  id: 'mission',
  meta: {
    title: 'Mission Control',
    description: 'Agents, runs and approvals at a glance.',
    approvals: 'frame',
    chat: {
      sessions: 'frame',
      thread: 'dense',
      approvals: 'card',
      turnHeader: () => import('@/layout-features/mission-board/RunTimeline'),
    },
  },
  load: () => import('@/app-layouts/mission/Frame'),
}
