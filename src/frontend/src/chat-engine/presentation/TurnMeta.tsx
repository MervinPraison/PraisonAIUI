/**
 * The header above an assistant turn in a layout's thread variant: an avatar,
 * the agent's name and the time (`bubbles`), a larger avatar (`steps`), or
 * a monospace meta line with the run id (`dense`). `quiet` shows none.
 * A lazy chunk, loaded only when a layout picks a thread variant.
 */
import type { JSX } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { cn } from '@/lib/utils'

export type ThreadVariant = 'bubbles' | 'quiet' | 'steps' | 'dense'

function clock(d: Date | undefined, seconds: boolean): string {
  if (!d || Number.isNaN(d.getTime())) return ''
  try {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) })
  } catch {
    return ''
  }
}

export default function TurnMeta({ variant }: { variant: ThreadVariant }): JSX.Element | null {
  const agent = useAuiState((s) => (s.message.metadata.custom as { agentName?: string }).agentName)
  const createdAt = useAuiState((s) => s.message.createdAt)
  const runId = useAuiState((s) => (s.message.metadata as { runId?: string }).runId)
  if (variant === 'quiet') return null
  const name = agent || 'Assistant'
  if (variant === 'dense') {
    // A long run id (a UUID) is cut to its first 8 characters.
    const run = runId && runId.length > 14 ? runId.slice(0, 8) : runId
    const meta = [clock(createdAt, true), run].filter(Boolean).join(' · ')
    return (
      <div className="mb-1 flex min-w-0 items-center gap-2" data-turn-meta="dense">
        <span className="shrink-0 text-sm font-semibold text-foreground">{name}</span>
        {meta && <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{meta}</span>}
      </div>
    )
  }
  const steps = variant === 'steps'
  const time = steps ? '' : clock(createdAt, false)
  return (
    <div className={cn('mb-2 flex min-w-0 items-center', steps ? 'gap-2.5' : 'gap-2')} data-turn-meta={variant}>
      <span
        className={cn(
          'flex shrink-0 items-center justify-center bg-primary/10 font-semibold text-primary',
          steps ? 'size-8 rounded-full text-sm' : 'size-6 rounded-md text-xs',
        )}
        aria-hidden
      >
        {name.charAt(0).toUpperCase()}
      </span>
      <span className={cn('min-w-0 truncate text-foreground', steps ? 'text-base font-bold' : 'text-sm font-semibold')}>{name}</span>
      {time && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{time}</span>}
    </div>
  )
}
