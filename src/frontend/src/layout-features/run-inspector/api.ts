/**
 * Tokens, cost and model of a run (ADR 0003 §3): from the `runs` layout
 * feed when a plugin provides it, else straight from the run ledger
 * (`GET /api/runs/{id}`, record `builtin.run-ledger`). The ledger is asked
 * only while its record is `ok` in the manifest, and again when the run
 * changes state (it finishes, it pauses): there is no wire event for usage.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useLayoutData } from '@/sdk/layouts'
import type { RunDetail, RunStatus } from '@/sdk/layoutTypes'
import type { ShellManifest } from '@/sdk/manifest'
import { fetchJson } from '@/sdk/services'

export const RUN_LEDGER_RECORD = 'builtin.run-ledger'

/** Whether this server keeps the run ledger (its record mounted, status `ok`). */
export function hasRunLedger(manifest: Pick<ShellManifest, 'plugins'> | null | undefined): boolean {
  return !!manifest?.plugins?.some((p) => p.name === RUN_LEDGER_RECORD && p.status === 'ok')
}

const STATUSES: readonly RunStatus[] = ['running', 'waiting', 'completed', 'failed', 'cancelled']
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

/** A ledger run as RunDetail, or null when it is not one. */
export function normalizeRunDetail(raw: unknown): RunDetail | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = str(r.id)
  const startedAt = num(r.startedAt)
  if (!id || startedAt === undefined) return null
  const status = STATUSES.includes(r.status as RunStatus) ? (r.status as RunStatus) : 'completed'
  return {
    id,
    startedAt,
    status,
    sessionId: str(r.sessionId),
    agent: str(r.agent),
    endedAt: num(r.endedAt),
    stepCount: num(r.stepCount),
    tokens: num(r.tokens),
    tokensIn: num(r.tokensIn),
    tokensOut: num(r.tokensOut),
    cost: num(r.cost),
    model: str(r.model),
    approximate: r.approximate === true || undefined,
    steps: [],
  }
}

const noSubscribe = () => () => {}
const nothing = () => null

/**
 * The run's ledger detail, or null (no run id, no ledger, not recorded yet).
 * `refreshKey`: ask the ledger again when it changes.
 */
export function useRunDetail(runId: string | undefined, enabled: boolean, refreshKey: string): RunDetail | null {
  const runs = useLayoutData('runs')
  const feed = useMemo(() => (runs && runId ? runs.run(runId) : null), [runs, runId])
  const fromFeed = useSyncExternalStore(feed?.subscribe ?? noSubscribe, feed?.get ?? nothing, feed?.get ?? nothing)
  const [fetched, setFetched] = useState<{ id: string; detail: RunDetail | null } | null>(null)

  useEffect(() => {
    if (feed || !enabled || !runId) return
    let alive = true
    fetchJson(`/api/runs/${encodeURIComponent(runId)}`)
      .then((raw) => alive && setFetched({ id: runId, detail: normalizeRunDetail(raw) }))
      // 404 until the ledger saw the run, or the record went away: keep what we had.
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [feed, enabled, runId, refreshKey])

  if (feed) return fromFeed
  return fetched && fetched.id === runId ? fetched.detail : null
}
