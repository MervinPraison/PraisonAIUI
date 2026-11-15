/**
 * The agents column's model (pure; agents.test.ts): the run ledger's agent
 * status joined with pending approvals, so an agent that waits on the viewer
 * shows as waiting even before the ledger's next poll, and approvals are
 * listed first ("approvals everywhere").
 */
import type { AgentStatus, ApprovalItem, SessionSummary } from '@/sdk/layoutTypes'

export type AgentState = AgentStatus['state']

export interface AgentView extends AgentStatus {
  /** The oldest pending approval this agent asked for. */
  approval?: ApprovalItem
}

const key = (name: string | undefined) => (name ?? '').trim().toLowerCase()

/** Pending approvals by agent name (case-insensitive), oldest first. */
function approvalsByAgent(pending: readonly ApprovalItem[]): Map<string, ApprovalItem> {
  const out = new Map<string, ApprovalItem>()
  const sorted = [...pending].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  for (const item of sorted) {
    const k = key(item.agentName)
    if (k && !out.has(k)) out.set(k, item)
  }
  return out
}

const ORDER: Record<AgentState, number> = { waiting: 0, running: 1, idle: 2 }

/**
 * Every agent to show: the ledger's, plus any agent with a pending approval
 * the ledger does not know (run history off). Waiting first, then running,
 * then idle; within a state the ledger's order (most recent first).
 */
export function agentViews(agents: readonly AgentStatus[], pending: readonly ApprovalItem[]): AgentView[] {
  const asks = approvalsByAgent(pending)
  const seen = new Set<string>()
  const out: AgentView[] = []
  for (const a of agents) {
    const k = key(a.name)
    if (!k || seen.has(k)) continue
    seen.add(k)
    const approval = asks.get(k)
    out.push(approval ? { ...a, state: 'waiting', approval } : { ...a })
  }
  for (const [k, approval] of asks) {
    if (!seen.has(k)) out.push({ name: approval.agentName!.trim(), state: 'waiting', approval })
  }
  return out
    .map((a, i) => ({ a, i }))
    .sort((x, y) => ORDER[x.a.state] - ORDER[y.a.state] || x.i - y.i)
    .map(({ a }) => a)
}

/** "1 running · 1 waiting · 1 idle" (states with no agent are left out). */
export function agentCountsLabel(agents: readonly Pick<AgentStatus, 'state'>[]): string {
  const n: Record<AgentState, number> = { running: 0, waiting: 0, idle: 0 }
  for (const a of agents) n[a.state]++
  return (['running', 'waiting', 'idle'] as const)
    .filter((s) => n[s] > 0)
    .map((s) => `${n[s]} ${s}`)
    .join(' · ')
}

/** The sessions of one agent, newest first (all sessions when none says which agent it ran). */
export function sessionsOf(sessions: readonly SessionSummary[], agent: string | null): { sessions: SessionSummary[]; filtered: boolean } {
  if (!agent) return { sessions: [...sessions], filtered: false }
  const k = key(agent)
  const mine = sessions.filter((s) => key(s.agent) === k)
  const known = sessions.some((s) => !!s.agent)
  return known ? { sessions: mine, filtered: true } : { sessions: [...sessions], filtered: false }
}

/** The agent the column shows first: the open chat's, else the first that waits or runs, else the first. */
export function defaultAgent(views: readonly AgentView[], openChatAgent: string | undefined): string | null {
  const k = key(openChatAgent)
  if (k) {
    const hit = views.find((a) => key(a.name) === k)
    if (hit) return hit.name
  }
  return views.find((a) => a.state !== 'idle')?.name ?? views[0]?.name ?? null
}
