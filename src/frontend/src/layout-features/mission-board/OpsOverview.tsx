/**
 * The ops overview (Mission's home, standing in for `overview` while
 * Mission is on screen): what waits on the viewer first, then today's KPIs,
 * every agent's status and the recent runs. On a phone it is the
 * MissionPhone.dc.html screen: approval cards, compact KPIs, and "tap an
 * agent to open its chat". Chunk lf-mission-board, loaded only on this page.
 */
import { useMemo } from 'react'
import { ApprovalCard, useSessions } from '@/app-layouts/kit'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { LayoutViewport } from '@/sdk/layouts'
import type { AgentStatus, RunStatus, RunSummary } from '@/sdk/layoutTypes'
import { agentCountsLabel, agentViews, sessionsOf } from './agents'
import { formatCost, formatCount, formatDuration, formatTime } from './format'
import { useApprovals, useFeed, useNow, useRuns, useRunsStatus } from './hooks'
import { AgentCard, KpiStrip, StateChip, type ChipState } from './widgets'

export interface OpsOverviewProps {
  viewport: LayoutViewport
  /** Open the chat page (after a session is picked). */
  openChat(): void
  /** `layout.options.mission.environment` ("prod"), shown beside the title. */
  environment?: string
}

const NO_AGENTS: readonly AgentStatus[] = Object.freeze([])
const NO_RUNS: readonly RunSummary[] = Object.freeze([])

const RUN_STATE: Record<RunStatus, { state: ChipState; label: string }> = {
  running: { state: 'running', label: 'Running' },
  waiting: { state: 'waiting', label: 'Waiting' },
  completed: { state: 'done', label: 'Succeeded' },
  failed: { state: 'failed', label: 'Failed' },
  cancelled: { state: 'idle', label: 'Cancelled' },
}

function SectionTitle({ children, meta }: { children: string; meta?: string }) {
  return (
    <div className="flex min-h-7 items-baseline gap-2">
      <h2 className="m-0 text-[13px] font-semibold tracking-wide text-muted-foreground">{children}</h2>
      {meta && <span className="truncate font-mono text-xs text-tier-3">{meta}</span>}
    </div>
  )
}

export default function OpsOverview({ viewport, openChat, environment }: OpsOverviewProps) {
  const phone = viewport === 'phone'
  const size = phone ? 'touch' : 'default'
  const runs = useRuns()
  const status = useRunsStatus(runs)
  const kpis = useFeed(useMemo(() => runs.kpis('today'), [runs]), null)
  const ledgerAgents = useFeed(useMemo(() => runs.agents(), [runs]), NO_AGENTS)
  const recent = useFeed(useMemo(() => runs.recent({ limit: 10 }), [runs]), NO_RUNS)
  const approvals = useApprovals()
  const sessions = useSessions()
  const views = useMemo(() => agentViews(ledgerAgents, approvals.pending), [ledgerAgents, approvals.pending])
  const now = useNow(views.some((a) => a.state !== 'idle'))

  const openAgent = (name: string) => {
    if (sessions) {
      const mine = sessionsOf(sessions.state.sessions, name)
      if (mine.filtered && mine.sessions[0]) sessions.feed.select(mine.sessions[0].id)
    }
    openChat()
  }

  const approvalList = approvals.feed && approvals.pending.length > 0 && (
    <section aria-label="Needs your approval" className="flex flex-col gap-2" data-aiui-ops-approvals="">
      <SectionTitle meta={`${approvals.pending.length} waiting`}>Needs your approval</SectionTitle>
      {approvals.pending.map((item) => (
        <ApprovalCard
          key={item.id}
          item={item}
          size={size}
          onApprove={() => approvals.feed!.approve(item.id)}
          onDeny={() => approvals.feed!.deny(item.id)}
        />
      ))}
    </section>
  )

  const agents = (
    <section aria-label="Agents" className="flex flex-col gap-2">
      {!phone && <SectionTitle meta={agentCountsLabel(views) || undefined}>Agents</SectionTitle>}
      {phone && views.length > 0 && <SectionTitle>Tap an agent to open its chat</SectionTitle>}
      {views.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">No agent has run yet. Start a chat to see it here.</p>
      ) : (
        views.map((a) => (
          <AgentCard
            key={a.name}
            agent={a}
            now={now}
            size={size}
            action={phone && a.state === 'running' ? 'Open chat' : undefined}
            onSelect={() => openAgent(a.name)}
          />
        ))
      )}
    </section>
  )

  return (
    <div data-aiui-ops-overview="" className={cn('mx-auto flex w-full flex-col', phone ? 'gap-3 px-4 pt-3 pb-4' : 'max-w-6xl gap-5 p-6')}>
      <header className="flex flex-wrap items-baseline gap-2">
        <h1 className={cn('m-0 font-semibold tracking-tight', phone ? 'text-[22px]' : 'text-xl')}>{phone ? 'Agents' : 'Overview'}</h1>
        {phone ? (
          views.length > 0 && <span className="font-mono text-[13px] text-tier-3">{agentCountsLabel(views)}</span>
        ) : (
          <span className="text-sm text-muted-foreground">Today{environment ? ` · ${environment}` : ''}</span>
        )}
      </header>

      {phone ? (
        <>
          {approvalList}
          <KpiStrip kpis={kpis} status={status} size="touch" />
          {agents}
        </>
      ) : (
        <>
          <KpiStrip kpis={kpis} status={status} />
          <div className={cn('grid gap-5', approvalList && 'lg:grid-cols-2')}>
            {approvalList}
            {agents}
          </div>
          <section aria-label="Recent runs" className="flex flex-col gap-2">
            <SectionTitle meta={kpis ? `${formatCount(kpis.runs)} today` : undefined}>Recent runs</SectionTitle>
            {status === 'off' ? (
              <p className="m-0 text-sm text-muted-foreground">Run history is off on this server.</p>
            ) : recent.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">No runs yet today.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table data-aiui-recent-runs="">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Agent</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Steps</TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recent.map((r) => {
                      const st = RUN_STATE[r.status] ?? RUN_STATE.completed
                      return (
                        <TableRow key={r.id} data-aiui-run={r.id}>
                          <TableCell className="font-mono text-xs">{formatTime(r.startedAt)}</TableCell>
                          <TableCell className="font-medium">{r.agent ?? '—'}</TableCell>
                          <TableCell>
                            <StateChip state={st.state} label={st.label} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{r.stepCount ?? '—'}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{formatDuration((r.endedAt ?? now) - r.startedAt)}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.tokens === undefined ? '—' : formatCount(r.tokens)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {formatCost(r.cost)}
                            {r.approximate && <span title="Joined by time window, not by run id"> ≈</span>}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
