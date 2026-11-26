/**
 * `kind=blocks` page (ADR-0001 §5, §9): GET `page.apiEndpoint`, turn the
 * `_components` payload into a BlockNode tree and render it with
 * BlockRenderer. Buttons with an `action` and forms POST to the page's action
 * endpoint; a response carrying a block tree replaces the page.
 *
 * Action endpoint: `page.actionEndpoint` (set by the server for
 * `register_page_action`); for plugin pages served under `/api/plugins/`,
 * `<apiEndpoint>/action`; otherwise `/api/pages/<id>/action`.
 * The URL query string is the page's params (pageParams.ts); `_refresh_every`
 * re-fetches while the tab is visible; lazy tabs and expanders load through
 * `loadSection` (docs/guides/server-pages.md).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { CircleX, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { ShellPage } from '../sdk/manifest'
import type { BlockNode } from '../sdk/registry'
import { BlockList } from './BlockRenderer'
import { BlockContext, type BlockActionRequest, type BlockContextValue } from './context'
import { notify } from '@/sdk/notify'
import { hasBlockTree, isRecord, str, toBlockTree } from './normalize'
import { actionBodyWithParams, nextRefreshDelay, paramsFromSearch, refreshSeconds, withQuery, writeParams } from './pageParams'

type PageState =
  | { status: 'loading'; key: string }
  | { status: 'ready'; key: string; nodes: BlockNode[]; updatedAt: number; refreshEvery: number }
  | { status: 'error'; key: string; error: string }

// eslint-disable-next-line react-refresh/only-export-components -- exported for tests and the shell
export function dataEndpoint(page: ShellPage): string {
  return page.apiEndpoint || `/api/pages/${encodeURIComponent(page.id)}/data`
}

// eslint-disable-next-line react-refresh/only-export-components -- exported for tests and the shell
export function actionEndpoint(page: ShellPage): string {
  if (page.actionEndpoint) return page.actionEndpoint
  const api = page.apiEndpoint
  if (api && api.startsWith('/api/plugins/')) return `${api.replace(/\/+$/, '')}/action`
  return `/api/pages/${encodeURIComponent(page.id)}/action`
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function errorText(data: unknown, res?: Response): string {
  if (isRecord(data)) {
    const msg = str(data.error ?? data.detail ?? data.message)
    if (msg) return msg
  }
  if (typeof data === 'string' && data.trim() && data.length < 300) return data.trim()
  return res ? `${res.status} ${res.statusText}`.trim() : 'Request failed'
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message || err.name : String(err)
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function LoadingSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-6" aria-hidden>
      <Skeleton className="h-6 w-48" />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

function applyDynamicManifest(data: unknown): void {
  if (!isRecord(data)) return
  if (isRecord(data._badges)) {
    window.dispatchEvent(new CustomEvent('aiui:badges-update', { detail: data._badges }))
  }
  if (data._refresh_manifest === true) {
    window.dispatchEvent(new Event('aiui:manifest-refresh'))
  }
}

function readyState(key: string, data: unknown): PageState {
  applyDynamicManifest(data)
  const refreshEvery = isRecord(data) ? refreshSeconds(data._refresh_every) : 0
  return { status: 'ready', key, nodes: toBlockTree(data).nodes, updatedAt: Date.now(), refreshEvery }
}

/** Write a reply's `_params` (or the submitted values) into the page URL. */
function writeUrlFrom(data: unknown, req: BlockActionRequest): void {
  if (isRecord(data) && isRecord(data._params)) writeParams(data._params)
  else if (req.updateUrl) writeParams(req.body)
}

export default function BlockPage({ page }: { page: ShellPage }): JSX.Element {
  const endpoint = dataEndpoint(page)
  const postUrl = actionEndpoint(page)
  const [state, setState] = useState<PageState>({ status: 'loading', key: endpoint })
  const [refreshing, setRefreshing] = useState(false)
  const inflight = useRef<AbortController | null>(null)
  /** Consecutive failed auto refreshes (back-off). */
  const failures = useRef(0)
  const lastLoad = useRef(0)
  const lastSearch = useRef(window.location.search)
  const suppressLocation = useRef(false)

  const writeUrlGuarded = useCallback((fn: () => void) => {
    suppressLocation.current = true
    try {
      fn()
      lastSearch.current = window.location.search
    } finally {
      suppressLocation.current = false
    }
  }, [])

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'retry' | 'auto') => {
      inflight.current?.abort()
      const ac = new AbortController()
      inflight.current = ac
      lastLoad.current = Date.now()
      lastSearch.current = window.location.search
      if (mode !== 'initial' && mode !== 'auto') setRefreshing(true)
      try {
        const res = await fetch(withQuery(endpoint, window.location.search), {
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
          signal: ac.signal,
        })
        const data = await readJson(res)
        if (!res.ok) throw new Error(errorText(data, res))
        if (ac.signal.aborted) return
        failures.current = 0
        setState(readyState(endpoint, data))
      } catch (err) {
        if (ac.signal.aborted) return
        const error = describe(err)
        const keep = mode === 'refresh' || mode === 'auto'
        // A failed refresh keeps the content on screen and reports via toast
        // (an auto refresh only on its first failure, then backs off quietly).
        if (mode === 'auto') failures.current += 1
        if (mode === 'refresh' || (mode === 'auto' && failures.current === 1))
          void notify(`Couldn't refresh ${page.title}`, { type: 'error', description: error })
        setState((prev) =>
          keep && prev.status === 'ready' && prev.key === endpoint ? prev : { status: 'error', key: endpoint, error },
        )
      } finally {
        if (inflight.current === ac) {
          inflight.current = null
          setRefreshing(false)
        }
      }
    },
    [endpoint, page.title],
  )

  useEffect(() => {
    void load('initial')
    // Back/forward or in-app page links that change the query string of this
    // page re-fetch with the new params.
    const path = window.location.pathname
    const onLocation = () => {
      if (suppressLocation.current) return
      if (window.location.pathname === path && window.location.search !== lastSearch.current) {
        void load('refresh')
      }
    }
    window.addEventListener('popstate', onLocation)
    window.addEventListener('aiui:locationchange', onLocation)
    return () => {
      window.removeEventListener('popstate', onLocation)
      window.removeEventListener('aiui:locationchange', onLocation)
      inflight.current?.abort()
      inflight.current = null
    }
  }, [load])

  // Auto refresh (`_refresh_every`): only while the tab is visible.
  const refreshEvery = state.status === 'ready' && state.key === endpoint ? state.refreshEvery : 0
  useEffect(() => {
    if (!refreshEvery) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const schedule = (ms: number) => {
      clearTimeout(timer)
      if (!stopped) timer = setTimeout(() => void tick(), ms)
    }
    const tick = async () => {
      if (document.visibilityState === 'hidden') return // resumed by visibilitychange
      if (!inflight.current) await load('auto')
      schedule(nextRefreshDelay(refreshEvery, failures.current))
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') return clearTimeout(timer)
      const due = lastLoad.current + nextRefreshDelay(refreshEvery, failures.current) - Date.now()
      schedule(Math.max(0, due))
    }
    schedule(nextRefreshDelay(refreshEvery, failures.current))
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refreshEvery, load])

  const runAction = useCallback(
    async (req: BlockActionRequest): Promise<boolean> => {
      const { body, label } = req
      if (req.method === 'get') {
        writeUrlGuarded(() => writeParams(body))
        await load('refresh')
        return true
      }
      const failTitle = label ? `${label} failed` : 'Action failed'
      try {
        const res = await fetch(postUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(actionBodyWithParams(body, window.location.search)),
        })
        const data = await readJson(res)
        if (!res.ok || (isRecord(data) && str(data.error))) {
          void notify(failTitle, { type: 'error', description: errorText(data, res) })
          return false
        }
        const message = isRecord(data) ? str(data.message ?? data.status) : ''
        writeUrlGuarded(() => writeUrlFrom(data, req))
        if (hasBlockTree(data)) {
          setState(readyState(endpoint, data))
          if (message) void notify(message, { type: 'success' })
        } else {
          applyDynamicManifest(data)
          void notify(message || (label ? `${label}: done` : 'Done'), { type: 'success' })
        }
        return true
      } catch (err) {
        void notify(failTitle, { type: 'error', description: describe(err) })
        return false
      }
    },
    [postUrl, endpoint, load, writeUrlGuarded],
  )

  const loadSection = useCallback(
    async (key: string, signal: AbortSignal): Promise<BlockNode[]> => {
      const res = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ _lazy: key, _params: paramsFromSearch(window.location.search) }),
        signal,
      })
      const data = await readJson(res)
      if (!res.ok || (isRecord(data) && str(data.error))) throw new Error(errorText(data, res))
      return toBlockTree(data).nodes
    },
    [postUrl],
  )

  const version = state.status === 'ready' ? state.updatedAt : 0
  const ctx = useMemo<BlockContextValue>(
    () => ({ page, runAction, loadSection, version }),
    [page, runAction, loadSection, version],
  )

  // A new endpoint (navigation to another blocks page) shows its own loading
  // state until its data arrives, never the previous page's blocks.
  const view: PageState = state.key === endpoint ? state : { status: 'loading', key: endpoint }

  return (
    <BlockContext.Provider value={ctx}>
      <div
        className="aiui-block-page flex min-w-0 flex-col gap-6"
        data-page={page.id}
        data-status={view.status}
        aria-busy={view.status === 'loading' || refreshing || undefined}
      >
        <div className="-mb-2 flex min-h-8 items-center justify-end gap-2 text-xs text-muted-foreground">
          {view.status === 'ready' && (
            <span className="tabular-nums" title={new Date(view.updatedAt).toISOString()}>
              Updated {formatTime(view.updatedAt)}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Refresh ${page.title}`}
            title="Refresh"
            disabled={refreshing || view.status === 'loading'}
            onClick={() => void load('refresh')}
          >
            <RefreshCw aria-hidden className={cn(refreshing && 'animate-spin motion-reduce:animate-[spin_1.6s_linear_infinite]')} />
          </Button>
        </div>

        {view.status === 'loading' && <LoadingSkeleton />}

        {view.status === 'error' && (
          <div role="alert" className="flex min-w-0 flex-col items-start gap-3 rounded-xl border border-border px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <CircleX aria-hidden className="size-4 text-destructive" />
              Couldn't load {page.title}
            </div>
            <p className="break-words text-xs text-muted-foreground">{view.error}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={refreshing}
              onClick={() => void load('retry')}
            >
              Try again
            </Button>
          </div>
        )}

        {view.status === 'ready' &&
          (view.nodes.length > 0 ? (
            <BlockList nodes={view.nodes} page={page} />
          ) : (
            <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
              This page has no content yet.
            </div>
          ))}
      </div>
    </BlockContext.Provider>
  )
}
