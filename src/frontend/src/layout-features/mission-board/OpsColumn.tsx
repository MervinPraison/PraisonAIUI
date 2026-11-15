/**
 * The operations column beside the chat (Mission.dc.html "Operations"):
 * today's KPI strip, every agent's status card (waiting ones first), and the
 * selected agent's sessions with New chat. Loaded by the Mission frame with
 * import() (chunk lf-mission-board) only while the chat page is on screen.
 */
import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useSessions } from '@/app-layouts/kit'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { AgentStatus } from '@/sdk/layoutTypes'
import { cn } from '@/lib/utils'
import { agentCountsLabel, agentViews, defaultAgent, sessionsOf, withChatGates } from './agents'
import { formatAgo } from './format'
import { useApprovals, useChat, useFeed, useNow, useRuns, useRunsStatus } from './hooks'
import { lastAssistant, timelineSteps } from './timeline'
import { AgentCard, KpiStrip } from './widgets'

const NO_AGENTS: readonly AgentStatus[] = Object.freeze([])

export interface OpsColumnProps {
  /** Open the chat page (after a session is picked or created). */
  openChat(): void
  className?: string
}

export default function OpsColumn({ openChat, className }: OpsColumnProps) {
  const runs = useRuns()
  const status = useRunsStatus(runs)
  const kpis = useFeed(useMemo(() => runs.kpis('today'), [runs]), null)
  const ledgerAgents = useFeed(useMemo(() => runs.agents(), [runs]), NO_AGENTS)
  const { pending } = useApprovals()
  const sessions = useSessions()
  const chat = useChat()
  const views = useMemo(() => agentViews(ledgerAgents, withChatGates(pending, chat.state.messages)), [ledgerAgents, pending, chat.state.messages])
  const turn = lastAssistant(chat.state.messages)
  const steps = useMemo(() => timelineSteps(turn), [turn])
  const now = useNow(views.some((a) => a.state !== 'idle') || chat.state.isRunning)

  const [picked, setPicked] = useState<string | null>(null)
  const selected = picked && views.some((a) => a.name === picked) ? picked : defaultAgent(views, turn?.agentName)
  const all = sessions?.state.sessions ?? []
  const mine = sessionsOf(all, selected)
  const activeId = sessions?.state.activeId ?? null
  const activeTitle = all.find((s) => s.id === activeId)?.title

  return (
    <section
      aria-label="Operations"
      data-aiui-ops-column=""
      className={cn('flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto border-r border-border bg-background p-4', className)}
    >
      <KpiStrip kpis={kpis} status={status} size="compact" />

      <div className="flex flex-col gap-1.5">
        <div className="flex h-7 items-center gap-2">
          <h2 className="m-0 text-[13px] font-semibold tracking-wide text-muted-foreground">Agents</h2>
          {views.length > 0 && <span className="truncate font-mono text-xs text-tier-3">{agentCountsLabel(views)}</span>}
        </div>
        {views.length === 0 && status === 'loading' ? (
          <div role="status" aria-label="Loading agents" className="flex flex-col gap-1.5">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ) : views.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">No agent has run yet. Start a chat to see it here.</p>
        ) : (
          views.map((a) => {
            const isOpenChat = !!turn?.agentName && turn.agentName.toLowerCase() === a.name.toLowerCase()
            return (
              <AgentCard
                key={a.name}
                agent={a}
                now={now}
                selected={a.name === selected}
                steps={isOpenChat ? steps : undefined}
                sessionTitle={isOpenChat ? activeTitle : undefined}
                onSelect={() => setPicked(a.name)}
              />
            )
          })
        )}
      </div>

      {sessions && (
        <div className="flex min-h-0 flex-col gap-1">
          <div className="flex h-8 items-center gap-2">
            <h2 className="m-0 min-w-0 truncate text-[13px] font-semibold tracking-wide text-muted-foreground">
              {mine.filtered && selected ? `${selected} · sessions` : 'Recent sessions'}
            </h2>
            <Button
              size="sm"
              className="ml-auto"
              onClick={() => {
                sessions.feed.create()
                openChat()
              }}
            >
              <Plus aria-hidden />
              New chat
            </Button>
          </div>
          {mine.sessions.length === 0 ? (
            <p className="m-0 px-2.5 text-sm text-muted-foreground">No sessions yet.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {mine.sessions.slice(0, 12).map((s) => {
                const current = s.id === activeId
                const running = sessions.state.runningIds.has(s.id)
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      data-aiui-session={s.id}
                      aria-current={current ? 'page' : undefined}
                      onClick={() => {
                        sessions.feed.select(s.id)
                        openChat()
                      }}
                      className={cn(
                        'flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2.5 text-left text-sm outline-none transition-colors',
                        'hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring',
                        current ? 'bg-accent-soft font-semibold text-link' : 'text-muted-foreground',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{s.title}</span>
                      <span className="shrink-0 font-mono text-xs font-normal text-tier-3">
                        {running ? 'live' : s.updatedAt ? formatAgo(s.updatedAt, now) : ''}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
