/**
 * The run timeline above each assistant turn (Mission `meta.chat.turnHeader`):
 * one segment per step, as wide as the step took, with its label and time
 * (Think 2.0s · terminal 0.3s · Answer 4.1s · Handoff → Coder · Approval
 * pending 0:42). Derived from the turn's own parts (./timeline), so it needs
 * no server call and shows nothing for a turn without steps.
 */
import { useMemo } from 'react'
import { Check, TriangleAlert, X } from 'lucide-react'
import type { TurnRegionProps } from '@/sdk/layouts'
import { cn } from '@/lib/utils'
import { formatClock, formatDuration } from './format'
import { useChat, useNow } from './hooks'
import { isLive, stepMs, stepWeight, timelineSteps } from './timeline'

export default function RunTimeline({ messageId }: TurnRegionProps) {
  const { state } = useChat()
  const message = state.messages.find((m) => m.id === messageId)
  const steps = useMemo(() => timelineSteps(message), [message])
  const now = useNow(isLive(steps))
  if (steps.length === 0) return null
  return (
    <ol aria-label="Run timeline" data-aiui-run-timeline="" className="m-0 flex list-none gap-1 overflow-x-auto p-0 pb-1">
      {steps.map((s) => {
        const ms = stepMs(s, now)
        const waiting = s.status === 'waiting'
        const time = waiting ? formatClock(ms) : formatDuration(ms)
        return (
          <li key={s.id} data-step-kind={s.kind} data-step-status={s.status} style={{ flexGrow: stepWeight(s, now) }} className="flex min-w-[88px] basis-0 flex-col gap-1">
            <span
              aria-hidden="true"
              className={cn(
                'h-1.5 rounded-[2px]',
                waiting
                  ? 'border-[1.5px] border-dashed border-[var(--ui-warning-line)] bg-warning-soft'
                  : s.status === 'error'
                    ? 'bg-destructive'
                    : s.status === 'running'
                      ? 'animate-pulse bg-primary motion-reduce:animate-none'
                      : 'bg-muted-foreground',
              )}
            />
            <span className={cn('flex items-center gap-1 text-xs whitespace-nowrap', waiting ? 'font-semibold text-warning' : 'text-muted-foreground')}>
              {waiting ? (
                <TriangleAlert aria-hidden className="size-3" />
              ) : s.status === 'error' ? (
                <X aria-hidden className="size-3 text-destructive" />
              ) : s.status === 'done' ? (
                <Check aria-hidden className="size-3" />
              ) : null}
              <span className="truncate">{s.label}</span>
              <span className={cn('font-mono', !waiting && 'text-tier-3')}>{time}</span>
              {s.status === 'running' && <span className="sr-only">(running)</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
