/**
 * Blocks for live server pages (docs/guides/server-pages.md):
 *
 * - `LazySection`: the body of a lazy tab or expander, fetched through the
 *   page's `loadSection` the first time it opens; a skeleton while loading, an
 *   error with "Try again" on failure. It re-fetches when the page reloads.
 * - `StatusBlock`: `{type: "status", label, state, detail, progress, log}`, a
 *   job row (queued, running, done, failed) with an optional log tail.
 */
import { useEffect, useState, type JSX } from 'react'
import { CircleCheck, CircleX, Clock, LoaderCircle, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { ShellPage } from '@/sdk/manifest'
import type { BlockNode } from '@/sdk/registry'
import { BlockList } from './BlockRenderer'
import { useBlockContext, useInFrame } from './context'
import { arr, num, str } from './normalize'

type SectionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; nodes: BlockNode[] }
  | { status: 'error'; error: string }

export function LazySection({ loadKey, open, page }: { loadKey: string; open: boolean; page?: ShellPage }): JSX.Element | null {
  const { loadSection, version } = useBlockContext()
  // Once opened, stays loaded (closing a tab or expander keeps its body).
  const [opened, setOpened] = useState(open)
  const [state, setState] = useState<SectionState>({ status: open ? 'loading' : 'idle' })
  const [attempt, setAttempt] = useState(0)
  if (open && !opened) {
    setOpened(true)
    setState({ status: 'loading' })
  }

  useEffect(() => {
    if (!opened) return
    const ac = new AbortController()
    // A reload (page data changed) keeps the loaded body on screen until the new one arrives.
    const run = loadSection
      ? loadSection(loadKey, ac.signal)
      : Promise.reject(new Error('Lazy sections need a server page'))
    run.then(
      (nodes) => {
        if (!ac.signal.aborted) setState({ status: 'ready', nodes })
      },
      (err: unknown) => {
        if (ac.signal.aborted) return
        const error = err instanceof Error ? err.message || err.name : String(err)
        setState((prev) => (prev.status === 'ready' ? prev : { status: 'error', error }))
      },
    )
    return () => ac.abort()
  }, [opened, loadKey, loadSection, version, attempt])

  if (!opened || state.status === 'idle') return null
  if (state.status === 'loading')
    return (
      <div className="flex min-w-0 flex-col gap-3" aria-busy="true" data-lazy={loadKey}>
        <span className="sr-only">Loading</span>
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  if (state.status === 'error')
    return (
      <div role="alert" className="flex min-w-0 flex-col items-start gap-2" data-lazy={loadKey}>
        <p className="flex items-center gap-2 text-sm text-foreground">
          <CircleX aria-hidden className="size-4 shrink-0 text-destructive" />
          Couldn't load this section
        </p>
        <p className="break-words text-xs text-muted-foreground">{state.error}</p>
        <Button type="button" size="sm" variant="outline" onClick={() => {
            setState({ status: 'loading' })
            setAttempt((n) => n + 1)
          }}>
          Try again
        </Button>
      </div>
    )
  if (state.nodes.length === 0) return <p className="text-sm text-muted-foreground">Nothing to show.</p>
  return <BlockList nodes={state.nodes} page={page} />
}

const STATES: Record<string, { icon: LucideIcon; tone: string; text: string }> = {
  queued: { icon: Clock, tone: 'text-muted-foreground', text: 'Queued' },
  running: { icon: LoaderCircle, tone: 'text-primary', text: 'Running' },
  done: { icon: CircleCheck, tone: 'text-success', text: 'Done' },
  failed: { icon: CircleX, tone: 'text-destructive', text: 'Failed' },
}

export function StatusBlock({ node, page }: { node: BlockNode; page?: ShellPage }): JSX.Element {
  const p = node.props ?? {}
  const nested = useInFrame()
  const stateKey = Object.prototype.hasOwnProperty.call(STATES, str(p.state)) ? str(p.state) : 'running'
  const { icon: Icon, tone, text } = STATES[stateKey]
  const label = str(p.label, 'Job')
  const detail = str(p.detail)
  const hasProgress = p.progress !== undefined && p.progress !== null
  const pct = Math.round(Math.min(100, Math.max(0, num(p.progress, 0))))
  const log = arr(p.log).map((line, i) => ({ id: String(i), message: str(line) }))
  const logNodes: BlockNode[] = log.length
    ? [{ type: 'log_viewer', props: { title: `${label} log`, entries: log } }]
    : []
  return (
    <div
      data-state={stateKey}
      className={cn('flex min-w-0 flex-col gap-3', !nested && 'rounded-xl border border-border px-4 py-3')}
    >
      <div className="flex min-w-0 items-start gap-3" aria-live="polite">
        <Icon
          aria-hidden
          className={cn(
            'mt-0.5 size-4 shrink-0',
            tone,
            stateKey === 'running' && 'animate-spin motion-reduce:animate-[spin_1.6s_linear_infinite]',
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
            <span className="min-w-0 truncate text-sm font-medium text-foreground">{label}</span>
            <span className={cn('text-xs font-medium', tone)}>
              {text}
              {hasProgress && stateKey === 'running' ? ` · ${pct}%` : ''}
            </span>
          </div>
          {detail && <p className="break-words text-xs text-muted-foreground">{detail}</p>}
        </div>
      </div>
      {hasProgress && (
        <div
          role="progressbar"
          aria-label={`${label} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-1.5 overflow-hidden rounded-full bg-secondary"
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-150 motion-reduce:transition-none',
              stateKey === 'failed' ? 'bg-destructive' : 'bg-primary',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {logNodes.length > 0 && <BlockList nodes={logNodes} page={page} />}
    </div>
  )
}
