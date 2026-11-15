/**
 * builtin.layout-mission: an operations view (KPIs, agents, approvals).
 * Stub descriptor: Track M lands the real frame, its `ops-overview` page and
 * `meta.approvals: 'frame'`.
 */
import type { LayoutDescriptor } from './types'

export const missionLayout: LayoutDescriptor = {
  id: 'mission',
  meta: { title: 'Mission Control', description: 'Agents, runs and approvals at a glance.' },
  load: () => import('@/app-layouts/mission/Frame'),
}
