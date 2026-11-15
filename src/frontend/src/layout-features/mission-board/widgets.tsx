/**
 * Mission board pieces shared by the ops column (beside the chat) and the
 * ops overview page: the state chip, the KPI strip, an agent's status card
 * and its step bar. Mission.dc.html / MissionPhone.dc.html with the Pro
 * tokens; tokens and primitives only.
 */
import { ChevronRight, TriangleAlert } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { RunKpis, RunStatus } from '@/sdk/layoutTypes'
import type { AgentState, AgentView } from './agents'
import { agentDoing, agentMeta, agentTimer, kpiCells, type KpiCell } from './cards'
import type { RunsStatus } from './runsFeed'
import { stepWeight, type TimelineStep } from './timeline'

/** `compact`: the narrow ops column (short labels); `touch`: a phone. */
export type BoardSize = 'default' | 'compact' | 'touch'

/** An agent's state, or a finished run's outcome. */
export type ChipState = AgentState | 'done' | 'failed'

const CHIP: Record<ChipState, { label: string; className: string }> = {
  running: { label: 'Running', className: 'bg-success text-success-foreground' },
  waiting: { label: 'Waiting for approval', className: 'bg-warning text-warning-foreground' },
  idle: { label: 'Idle', className: 'border border-border text-muted-foreground font-medium' },
  done: { label: 'Succeeded', className: 'bg-success-soft text-success' },
  failed: { label: 'Failed', className: 'bg-danger-soft text-destructive' },
}

/** A finished or live run's chip (the overview's table, the ops column's list). */
export const RUN_STATE: Record<RunStatus, { state: ChipState; label: string }> = {
  running: { state: 'running', label: 'Running' },
  waiting: { state: 'waiting', label: 'Waiting' },
  completed: { state: 'done', label: 'Succeeded' },
  failed: { state: 'failed', label: 'Failed' },
  cancelled: { state: 'idle', label: 'Cancelled' },
}

export function StateChip({ state, label, size = 'default' }: { state: ChipState; label?: string; size?: BoardSize }) {
  const c = CHIP[state]
  return (
    <span
      data-aiui-agent-state={state}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-xs px-1.5 font-semibold whitespace-nowrap',
        size === 'touch' ? 'h-[22px] text-[13px]' : 'h-5 text-xs',
        c.className,
      )}
    >
      {state === 'waiting' ? (
        <TriangleAlert aria-hidden className="size-3" />
      ) : (
        <span aria-hidden="true" className={cn('size-2 rounded-full', state === 'running' ? 'bg-current' : 'border-[1.5px] border-current')} />
      )}
      {label ?? c.label}
    </span>
  )
}

// ── KPI strip ────────────────────────────────────────────────────────

const SKELETON_CELLS = (['runs', 'success', 'cost', 'latency'] as const).map((id) => ({ id, label: '', value: '' }) as KpiCell)

export function KpiStrip({ kpis, status, size = 'default' }: { kpis: RunKpis | null; status: RunsStatus; size?: BoardSize }) {
  const touch = size === 'touch'
  if (status === 'off' || (status === 'error' && !kpis)) {
    return (
      <p data-aiui-kpis="off" className="m-0 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground">
        {status === 'off'
          ? 'Run history is off on this server, so there are no run counts, success rate or cost yet.'
          : 'Could not load today’s runs. Retrying…'}
      </p>
    )
  }
  const cells = kpis ? kpiCells(kpis) : null
  return (
    <div
      role="list"
      aria-label="Today"
      data-aiui-kpis=""
      className={cn('grid grid-cols-4 rounded-lg border border-border bg-card text-card-foreground', touch && 'rounded-xl')}
    >
      {(cells ?? SKELETON_CELLS).map((c, i) => (
        <div key={c.id} role="listitem" className={cn('flex min-w-0 flex-col gap-0.5', touch ? 'p-2' : size === 'compact' ? 'px-2 pt-2.5 pb-2' : 'px-2.5 pt-2.5 pb-2', i > 0 && 'border-l border-hairline')}>
          {cells ? (
            <>
              <span className="truncate text-xs text-tier-3">{size === 'default' ? c.label : (c.shortLabel ?? c.label)}</span>
              <span className={cn('font-semibold tracking-tight tabular-nums', touch ? 'text-lg' : 'text-xl')}>{c.value}</span>
              {!touch && c.sub && (
                <span className={cn('truncate font-mono text-xs', c.tone === 'success' ? 'text-success' : c.tone === 'warning' ? 'text-warning' : 'text-tier-3')}>
                  {c.sub}
                </span>
              )}
            </>
          ) : (
            <>
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="mt-1 h-5 w-1/2" />
            </>
          )}
        </div>
      ))}
    </div>
  )
}

// ── agents ───────────────────────────────────────────────────────────

/** Proportional segments of a run (done solid, running accent, waiting dashed). */
export function StepBar({ steps, now, size = 'default' }: { steps: readonly TimelineStep[]; now: number; size?: BoardSize }) {
  if (steps.length === 0) return null
  return (
    <span aria-hidden="true" className="flex gap-[3px]">
      {steps.map((s) => (
        <span
          key={s.id}
          style={{ flexGrow: stepWeight(s, now) }}
          className={cn(
            'basis-0 rounded-[2px]',
            size === 'touch' ? 'h-[5px]' : 'h-1',
            s.status === 'waiting'
              ? 'border border-dashed border-[var(--ui-warning-line)] bg-warning-soft'
              : s.status === 'error'
                ? 'bg-destructive'
                : s.status === 'running'
                  ? 'bg-primary'
                  : 'bg-muted-foreground',
          )}
        />
      ))}
    </span>
  )
}

export interface AgentCardProps {
  agent: AgentView
  now: number
  selected?: boolean
  steps?: readonly TimelineStep[]
  sessionTitle?: string
  size?: BoardSize
  /** Phone: the card opens the agent's chat ("Open chat"). */
  action?: string
  onSelect(): void
}

export function AgentCard({ agent: a, now, selected, steps, sessionTitle, size = 'default', action, onSelect }: AgentCardProps) {
  const touch = size === 'touch'
  const timer = agentTimer(a, now)
  const meta = agentMeta(a)
  const doing = agentDoing(a, now, sessionTitle)
  const waiting = a.state === 'waiting'
  return (
    <button
      type="button"
      aria-pressed={action ? undefined : !!selected}
      data-aiui-agent={a.name}
      onClick={onSelect}
      className={cn(
        'flex w-full min-w-0 flex-col gap-1.5 rounded-lg border bg-card px-3 py-2.5 text-left text-card-foreground outline-none transition-colors',
        'hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring',
        touch && 'min-h-11 rounded-xl p-3',
        waiting ? 'border-[var(--ui-warning-line)] bg-warning-soft' : selected ? 'border-primary' : 'border-border',
      )}
    >
      <span className="flex w-full items-center gap-2">
        <span className={cn('truncate font-semibold', touch ? 'text-base' : 'text-sm')}>{a.name}</span>
        <StateChip state={a.state} size={size} label={touch && waiting ? 'Needs approval' : undefined} />
        {timer && (
          <span className={cn('ml-auto shrink-0 font-mono text-xs tabular-nums', timer.warn ? 'font-medium text-warning' : 'text-tier-3')}>
            {timer.text}
          </span>
        )}
      </span>
      <span className={cn('truncate text-muted-foreground', touch ? 'text-[15px]' : 'text-[13px]')}>
        {doing.text}
        {doing.code && (
          <>
            {' '}
            <code className="font-mono text-xs text-foreground">{doing.code}</code>
          </>
        )}
      </span>
      {steps && steps.length > 0 && <StepBar steps={steps} now={now} size={size} />}
      {(meta || action) && (
        <span className={cn('flex w-full items-center gap-2', action && 'border-t border-hairline pt-2')}>
          {meta && <span className="truncate font-mono text-xs text-tier-3">{meta}</span>}
          {action && (
            <span className="ml-auto flex min-h-7 items-center gap-1 text-[15px] font-semibold text-link">
              {action}
              <ChevronRight aria-hidden className="size-4" />
            </span>
          )}
        </span>
      )}
    </button>
  )
}
