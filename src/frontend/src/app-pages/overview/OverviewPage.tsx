/**
 * Overview (ProOverview.dc.html), the app shell's page for `overview` inside
 * a layout: a greeting with one plain sentence, "Today at a glance" (96px
 * tiles: 12px label, 28px tabular number, a 12px delta or sparkline), the
 * agents beside what needs your approval, the recent runs (or chats)
 * beside the model provider with the collapsible feature health list under
 * it. A zero KPI is muted, its line saying what to do.
 *
 * Bound to the same stores the chat and the layouts read: the approvals feed
 * plus the open chat's gates, the sessions feed, and the runs feed when the
 * run ledger is on (else usage totals). Status is a dot and a label.
 */
import { useMemo, useState, useSyncExternalStore } from 'react'
import { Bot, ChevronRight, Settings2, ShieldQuestion, SquarePen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { chatGates, withChatGates } from '@/lib/chatGates'
import { cn } from '@/lib/utils'
import { useLayoutData } from '@/sdk/layouts'
import type { ApprovalItem, Feed, RunKpis, RunSummary, AgentStatus } from '@/sdk/layoutTypes'
import { navigate, useManifest } from '@/sdk/services'
import { ago, inLayoutOnly, PageBody, Pill, providerName, Section, StatusDot, toMs, useJson, useNow, type AppPageProps, type Tone } from '../shared'
import { attentionLabel, featureHealth, formatCost, formatCount, formatMs, greeting, providerLine, series, sparkPath, summary } from './model'

const NOTHING = { get: () => null, subscribe: () => () => {} }

function useFeedValue<T>(feed: Feed<T> | null | undefined, fallback: T): T {
  const f = (feed ?? NOTHING) as Feed<T | null>
  const v = useSyncExternalStore(f.subscribe, f.get, f.get)
  return v ?? fallback
}

const NO_RUNS: readonly RunSummary[] = []
const NO_AGENTS: readonly AgentStatus[] = []

const RUN_TONE: Record<string, { tone: Tone; label: string }> = {
  running: { tone: 'ok', label: 'Running' },
  waiting: { tone: 'warn', label: 'Waiting for approval' },
  completed: { tone: 'ok', label: 'Succeeded' },
  failed: { tone: 'bad', label: 'Failed' },
  cancelled: { tone: 'idle', label: 'Cancelled' },
}

function describe(a: ApprovalItem): string {
  const args = a.args ?? {}
  const cmd = ['command', 'cmd', 'code', 'query', 'url', 'path'].map((k) => args[k]).find((v) => typeof v === 'string')
  return typeof cmd === 'string' ? cmd : a.toolName ?? 'a tool'
}

function Spark({ values, label }: { values: readonly number[]; label: string }) {
  const points = sparkPath(values, 72, 20)
  if (!points) return null
  return (
    <svg viewBox="0 0 72 20" width="72" height="20" role="img" aria-label={label} className="shrink-0 text-primary">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/**
 * One cell of the KPI strip. `empty`: the value is zero, so it is muted and
 * the line under it says what to do. `warn`: a warning dot and value colour
 * (the strip's hairlines carry no per-cell border).
 */
function Tile({ label, value, sub, spark, tone, empty }: { label: string; value: string; sub?: string; spark?: { values: readonly number[]; label: string }; tone?: 'warn'; empty?: boolean }) {
  return (
    <div className="flex min-h-24 min-w-0 flex-col justify-between gap-1 bg-card px-5 py-4" data-aiui-tile="" data-empty={empty || undefined} data-tone={tone}>
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        {tone === 'warn' && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-warning" />}
        <span className="truncate">{label}</span>
      </span>
      <span className="flex items-end justify-between gap-2">
        <span className={cn('text-2xl leading-8 tracking-[-0.02em] tabular-nums', empty ? 'font-medium text-tier-3' : 'font-semibold', tone === 'warn' && 'text-warning')}>{value}</span>
        {spark && !empty && <Spark {...spark} />}
      </span>
      <span className="truncate text-xs text-tier-3">{sub || ' '}</span>
    </div>
  )
}

function ApprovalCard({ item, decide }: { item: ApprovalItem; decide(item: ApprovalItem, approved: boolean): Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const act = (approved: boolean) => async () => {
    setBusy(true)
    setError(null)
    try {
      await decide(item, approved)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The decision did not reach the server.')
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 [border-color:var(--ui-warning-line)]" data-aiui-approval={item.id}>
      <div className="flex items-start gap-3">
        <ShieldQuestion aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-medium text-foreground">
            {item.agentName || 'An agent'} wants to use {item.toolName || 'a tool'}
          </p>
          {item.description && <p className="m-0 mt-1 text-sm text-muted-foreground">{item.description}</p>}
        </div>
        {item.riskLevel && <Pill tone={/high|critical/i.test(item.riskLevel) ? 'bad' : 'warn'}>{item.riskLevel} risk</Pill>}
      </div>
      <code className="rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs break-all text-foreground">{describe(item)}</code>
      {error && (
        <p role="alert" className="m-0 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={act(false)}>
          Not now
        </Button>
        <Button size="sm" disabled={busy} onClick={act(true)}>
          Approve
        </Button>
      </div>
    </div>
  )
}

function OverviewPage(_: AppPageProps) {
  const now = useNow()
  const manifest = useManifest()
  const hasPage = (id: string) => !!manifest?.pages.some((p) => p.id === id)

  const approvalsFeed = useLayoutData('approvals')
  const chatFeed = useLayoutData('chat')
  const sessionsFeed = useLayoutData('sessions')
  const runsFeed = useLayoutData('runs')
  const pendingListed = useFeedValue(approvalsFeed, { pending: [] as readonly ApprovalItem[] }).pending
  const chat = useFeedValue(chatFeed, { sessionId: null, messages: [], isRunning: false })
  const sessions = useFeedValue(sessionsFeed, { sessions: [], activeId: null, runningIds: new Set<string>(), loading: false })
  const pending = useMemo(() => withChatGates(pendingListed, chat.messages), [pendingListed, chat.messages])
  const gateIds = useMemo(() => new Set(chatGates(chat.messages).map((g) => g.id)), [chat.messages])

  const kpisFeed = useMemo(() => runsFeed?.kpis('today') ?? null, [runsFeed])
  const agentsFeed = useMemo(() => runsFeed?.agents() ?? null, [runsFeed])
  const recentFeed = useMemo(() => runsFeed?.recent({ limit: 6 }) ?? null, [runsFeed])
  const kpis = useFeedValue<RunKpis | null>(kpisFeed, null)
  const agents = useFeedValue(agentsFeed, NO_AGENTS)
  const recent = useFeedValue(recentFeed, NO_RUNS)

  const usage = useJson<{ total_tokens?: number; total_cost_usd?: number }>('/api/usage/summary', 30_000)
  const timeseries = useJson<unknown>('/api/usage/timeseries?hours=24', 60_000)
  const health = useJson<{ status?: string; provider?: string; detail?: string; api_key?: string }>('/api/provider/health', 30_000)
  const features = useJson<unknown>('/api/features')
  const tokens = series(timeseries.data, 'tokens')
  const requests = series(timeseries.data, 'requests')

  const running = sessions.runningIds.size + (chat.isRunning && chat.sessionId && !sessions.runningIds.has(chat.sessionId) ? 1 : 0)
  const decide = async (item: ApprovalItem, approved: boolean) => {
    if (gateIds.has(item.id) && chatFeed) await chatFeed.resolveApproval(item.id, approved)
    else if (approvalsFeed) await (approved ? approvalsFeed.approve(item.id) : approvalsFeed.deny(item.id))
  }

  const provider = providerLine(health.data, health.error)
  const keyMissing = provider.addKey === true
  const healthList = featureHealth(features.data)
  const unhealthy = healthList.filter((f) => !f.ok)

  return (
    <div className="min-h-0 min-w-0 flex-1" data-aiui-app-page="overview">
      <PageBody wide>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-2xl leading-8 font-semibold tracking-tight">{greeting(new Date(now))}</h2>
            <p className="m-0 mt-1 text-sm text-muted-foreground">
              {summary({ waiting: pending.length, running, agentWaiting: pending[0]?.agentName, attention: unhealthy.length, keyMissing })}
            </p>
          </div>
          {/* Page-level New chat: the same small primary button with the sidebar's pencil, on every page that has one. */}
          {/* Centred on the title's 32px line. */}
          <Button size="sm" className="mt-0.5" onClick={() => navigate('chat')}>
            <SquarePen aria-hidden />
            New chat
          </Button>
        </div>

        <Section title="Today at a glance">
          {/* One joined strip (ProOverview): hairline separators drawn by the 1px gaps over the border colour. */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
            {kpis ? (
              <Tile label="Runs today" value={formatCount(kpis.runs)} sub={kpis.runsDelta ? `${kpis.runsDelta > 0 ? '+' : ''}${kpis.runsDelta} vs yesterday` : 'same as yesterday'} spark={{ values: requests, label: 'Requests per hour, last 24 hours' }} />
            ) : (
              <Tile label="Chats" value={formatCount(sessions.sessions.length)} sub={sessions.sessions.length ? (running ? `${running} running now` : 'none running') : 'No chats yet · start one'} empty={sessions.sessions.length === 0} />
            )}
            <Tile label="Waiting for you" value={String(pending.length)} sub={pending.length ? `oldest ${ago(pending[0]?.createdAt ?? Number.NaN, now) || 'just now'}` : 'nothing to approve'} tone={pending.length ? 'warn' : undefined} empty={pending.length === 0} />
            <Tile label="Tokens today" value={formatCount(usage.data?.total_tokens ?? 0)} sub={usage.data?.total_tokens ? 'last 24 hours' : 'none used yet today'} spark={{ values: tokens, label: 'Tokens per hour, last 24 hours' }} empty={!usage.data?.total_tokens} />
            {kpis?.p50Ms !== undefined ? (
              <Tile label="p50 response time" value={formatMs(kpis.p50Ms)} sub={kpis.p95Ms !== undefined ? `p95 ${formatMs(kpis.p95Ms)}` : undefined} />
            ) : (
              <Tile label="Cost today" value={formatCost(usage.data?.total_cost_usd ?? 0)} sub={usage.data?.total_cost_usd ? 'estimated' : 'nothing spent yet'} empty={!usage.data?.total_cost_usd} />
            )}
          </div>
        </Section>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section
            title="Needs your approval"
            meta={pending.length ? String(pending.length) : undefined}
            action={hasPage('approvals') ? (
              <Button variant="link" size="sm" className="h-auto px-0" onClick={() => navigate('approvals')}>
                All approvals
              </Button>
            ) : undefined}
          >
            {pending.length === 0 ? (
              <p className="m-0 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Nothing waits for you.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {pending.slice(0, 3).map((a) => (
                  <ApprovalCard key={a.id} item={a} decide={decide} />
                ))}
              </div>
            )}
          </Section>
          <Section
            title="Agents"
            meta={agents.length ? `${agents.filter((a) => a.state === 'running').length} running · ${agents.filter((a) => a.state === 'waiting').length} waiting` : undefined}
            action={hasPage('agents') ? (
              <Button variant="link" size="sm" className="h-auto px-0" onClick={() => navigate('agents')}>
                Manage agents
              </Button>
            ) : undefined}
          >
            {agents.length === 0 ? (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-4">
                <Bot aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <p className="m-0 min-w-0 flex-1 text-sm text-muted-foreground">No agent has run today. The default agent answers new chats.</p>
              </div>
            ) : (
              <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-xl border border-border bg-card p-0">
                {agents.map((a) => (
                  <li key={a.name} className="flex items-center gap-3 px-4 py-3" data-aiui-agent={a.name}>
                    <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-xs font-semibold text-link">
                      {a.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{a.name}</span>
                      <span className="block truncate text-xs text-tier-3">
                        {a.lastRunAt ? `last run ${ago(a.lastRunAt, now)}` : 'no run yet'}
                        {a.model ? ` · ${a.model}` : ''}
                      </span>
                    </span>
                    {a.state === 'running' ? <Pill tone="ok">Running</Pill> : a.state === 'waiting' ? <Pill tone="warn">Waiting</Pill> : <Pill tone="idle">Idle</Pill>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          {recent.length > 0 ? (
            <Section title="Recent runs" action={hasPage('runs') ? (
              <Button variant="link" size="sm" className="h-auto px-0" onClick={() => navigate('runs')}>
                All runs
              </Button>
            ) : undefined}>
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full text-sm" aria-label="Recent runs">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th scope="col" className="px-4 py-2 font-medium">Agent</th>
                      <th scope="col" className="px-4 py-2 font-medium">Status</th>
                      <th scope="col" className="px-4 py-2 font-medium">Started</th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">Duration</th>
                      <th scope="col" className="px-4 py-2 text-right font-medium">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((r) => {
                      const st = RUN_TONE[r.status] ?? RUN_TONE.completed
                      return (
                        <tr key={r.id} className="border-b border-border last:border-0" data-aiui-run={r.id}>
                          <td className="px-4 py-2.5 font-medium">{r.agent ?? 'Agent'}</td>
                          <td className="px-4 py-2.5">
                            <Pill tone={st.tone}>{st.label}</Pill>
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{ago(r.startedAt, now)}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs tabular-nums">{formatMs((r.endedAt ?? now) - r.startedAt)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{formatCount(r.tokens)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          ) : (
            <Section title="Recent chats" action={hasPage('sessions') ? (
              <Button variant="link" size="sm" className="h-auto px-0" onClick={() => navigate('sessions')}>
                All sessions
              </Button>
            ) : undefined}>
              {sessions.sessions.length === 0 ? (
                <p className="m-0 text-sm text-muted-foreground">No chats yet.</p>
              ) : (
                <ul className="m-0 flex list-none flex-col divide-y divide-border rounded-xl border border-border bg-card p-0">
                  {sessions.sessions.slice(0, 5).map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          sessionsFeed?.select(s.id)
                          navigate('chat')
                        }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm outline-none hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="min-w-0 flex-1 truncate">{s.title}</span>
                        <span className="shrink-0 text-xs text-tier-3">{ago(toMs(s.updatedAt), now)}</span>
                        <ChevronRight aria-hidden className="size-4 shrink-0 text-tier-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
          <div className="flex min-w-0 flex-col gap-6">
            <Section title="Model provider" action={hasPage('config') ? (
              <Button variant="ghost" size="icon-sm" aria-label="Open settings" onClick={() => navigate('config')}>
                <Settings2 aria-hidden />
              </Button>
            ) : undefined}>
              {/* The same source the Settings page and the chat's setup banner read (/api/provider/health). */}
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3" data-aiui-provider="">
                <span className="text-sm font-medium" title={health.data?.provider}>{providerName(health.data?.provider) || 'Provider'}</span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <StatusDot tone={health.loading ? 'idle' : provider.tone}>{health.loading ? 'Checking…' : provider.text}</StatusDot>
                  {provider.addKey && hasPage('config') && (
                    <Button variant="link" size="sm" className="h-auto px-0" onClick={() => navigate('config')}>
                      Add key
                    </Button>
                  )}
                </span>
              </div>
            </Section>
            {healthList.length > 0 && (
              <details className="group/fh rounded-xl border border-border bg-card" data-aiui-feature-health="">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open/fh:rotate-90" />
                  Feature health
                  <span className="flex-1" />
                  <StatusDot tone={unhealthy.length ? 'warn' : 'ok'}>{unhealthy.length ? attentionLabel(unhealthy.length) : `all ${healthList.length} healthy`}</StatusDot>
                </summary>
                <ul className="m-0 grid list-none gap-y-1.5 border-t border-border p-4">
                  {healthList.map((f) => (
                    <li key={f.name} className="flex min-w-0 items-center justify-between gap-2">
                      <span className="truncate text-xs">{f.name}</span>
                      <StatusDot tone={f.ok ? 'ok' : 'warn'}>{f.status}</StatusDot>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      </PageBody>
    </div>
  )
}

export default inLayoutOnly(OverviewPage)
