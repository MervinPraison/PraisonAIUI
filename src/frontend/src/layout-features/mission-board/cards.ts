/**
 * What the KPI strip, the agent cards and the banner say (pure;
 * agents.test.ts): the four KPI cells of a window, an agent card's
 * activity line, meta line and timer, and the banner's title.
 */
// The kit's own module, not its index: only this board uses it, so it ships in
// lf-mission-board and the kit chunk every layout loads stays as it is.
import { describeCall } from '@/app-layouts/kit/format'
import type { ApprovalItem, RunKpis } from '@/sdk/layoutTypes'
import type { AgentView } from './agents'
import { formatAgo, formatClock, formatCost, formatCount, formatDelta, formatDuration, formatPercent, formatTokens, metaLine } from './format'

export interface KpiCell {
  id: 'runs' | 'success' | 'cost' | 'latency'
  label: string
  /** The phone's label (the strip is four narrow cells). */
  shortLabel?: string
  value: string
  sub?: string
  tone?: 'success' | 'warning'
}

export function kpiCells(k: RunKpis): KpiCell[] {
  const over = k.budget !== undefined && k.cost !== undefined && k.cost > k.budget
  const rated = k.successRate !== undefined
  return [
    { id: 'runs', label: 'Runs today', shortLabel: 'Runs', value: formatCount(k.runs), sub: formatDelta(k.runsDelta) || undefined },
    { id: 'success', label: 'Success', value: formatPercent(k.successRate), sub: rated ? 'finished' : 'none finished', tone: rated ? 'success' : undefined },
    { id: 'cost', label: 'Cost today', shortLabel: 'Cost', value: formatCost(k.cost), sub: k.budget === undefined ? undefined : `of ${formatCost(k.budget)}`, tone: over ? 'warning' : undefined },
    { id: 'latency', label: 'p50 latency', shortLabel: 'p50', value: formatDuration(k.p50Ms), sub: k.p95Ms === undefined ? undefined : `p95 ${formatDuration(k.p95Ms)}` },
  ]
}

/** The card's second line: the call it waits on, the chat it runs, or its last run. */
export function agentDoing(a: AgentView, now: number, sessionTitle?: string): { text: string; code?: string } {
  if (a.approval) {
    const call = describeCall(a.approval)
    return { text: 'Wants to run', code: call.length > 60 ? `${call.slice(0, 59)}…` : call }
  }
  if (a.state === 'running') return { text: sessionTitle || 'Working on a run' }
  return { text: a.lastRunAt ? `Last run ${formatAgo(a.lastRunAt, now)}` : 'No runs yet' }
}

/** "gpt-4o-mini · 3,412 tok · $0.012" (today's tokens and cost). */
export function agentMeta(a: AgentView): string {
  return metaLine(a.model, a.tokensToday ? formatTokens(a.tokensToday) : undefined, a.costToday ? formatCost(a.costToday) : undefined)
}

/** Waiting "0:42" (a warning), running "7.0s", idle "38m ago". */
export function agentTimer(a: AgentView, now: number): { text: string; warn: boolean } | null {
  if (a.approval?.createdAt) return { text: formatClock(now - a.approval.createdAt), warn: true }
  if (a.state === 'running' && a.elapsedMs !== undefined) return { text: formatDuration(a.elapsedMs), warn: false }
  if (a.state === 'idle' && a.lastRunAt) return { text: formatAgo(a.lastRunAt, now), warn: false }
  return null
}

/** "Coder needs your approval to continue" (the banner's title). */
export function approvalTitle(item: Pick<ApprovalItem, 'agentName'>): string {
  return `${item.agentName?.trim() || 'An agent'} needs your approval to continue`
}

/** "Coder wants to run a command" / "Coder wants to use web_search" (a request card's title). */
export function requestTitle(item: Pick<ApprovalItem, 'agentName' | 'toolName'>): string {
  const who = item.agentName?.trim() || 'An agent'
  const tool = item.toolName?.trim()
  return !tool || /^(shell|terminal|bash|exec|run_command|execute_command)$/i.test(tool) ? `${who} wants to run a command` : `${who} wants to use ${tool}`
}
