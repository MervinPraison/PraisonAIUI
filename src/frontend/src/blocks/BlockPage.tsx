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
import { isNdjsonContentType, readNdjsonStream } from './actionStream'
import { BlockList } from './BlockRenderer'
import { preloadCoreBlockTypes } from './coreBlocks'
import { BlockContext, type BlockActionRequest, type BlockContextValue } from './context'
import { notify } from '@/sdk/notify'
import { useLiveData, type LiveDataErrorInfo } from '@/sdk/liveData'
import { hasBlockTree, isRecord, str, toBlockNodes, toBlockTree } from './normalize'
import { actionBodyWithParams, paramsFromSearch, refreshSeconds, withQuery, writeParams } from './pageParams'

interface BlockPageData {
  nodes: BlockNode[]
  refreshEvery: number
}

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
  if (Array.isArray(data._notifications)) {
    for (const entry of data._notifications) {
      if (isRecord(entry)) {
        window.dispatchEvent(new CustomEvent('aiui:notification', { detail: entry }))
      }
    }
  }
}

function parseBlockPageData(data: unknown): BlockPageData {
  applyDynamicManifest(data)
  const refreshEvery = isRecord(data) ? refreshSeconds(data._refresh_every) : 0
  return { nodes: toBlockTree(data).nodes, refreshEvery }
}

/** Write a reply's `_params` (or the submitted values) into the page URL. */
function writeUrlFrom(data: unknown, req: BlockActionRequest): void {
  if (isRecord(data) && isRecord(data._params)) writeParams(data._params)
  else if (req.updateUrl) writeParams(req.body)
}

export default function BlockPage({ page }: { page: ShellPage }): JSX.Element {
  const endpoint = dataEndpoint(page)
  const postUrl = actionEndpoint(page)
  const [streaming, setStreaming] = useState(false)
  const actionAbort = useRef<AbortController | null>(null)
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

  const fetchPage = useCallback(
    async (signal: AbortSignal): Promise<BlockPageData> => {
      lastSearch.current = window.location.search
      const res = await fetch(withQuery(endpoint, window.location.search), {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        signal,
      })
      const data = await readJson(res)
      if (!res.ok) throw new Error(errorText(data, res))
      return parseBlockPageData(data)
    },
    [endpoint],
  )

  const handleLoadError = useCallback(
    (err: Error, { mode, failures, retained }: LiveDataErrorInfo) => {
      // A failed refresh keeps the content on screen and reports via toast
      // (an auto refresh only on its first failure, then backs off quietly).
      // Without content the inline error card already says it: no toast.
      if (retained && (mode === 'refresh' || (mode === 'auto' && failures === 1))) {
        void notify(`Couldn't refresh ${page.title}`, { type: 'error', description: describe(err) })
      }
    },
    [page.title],
  )

  const { data: pageData, error: pageError, loading, refreshing, updatedAt, refresh, setData } = useLiveData<BlockPageData>(
    endpoint,
    fetchPage,
    {
      intervalMs: (d) => (d?.refreshEvery ?? 0) * 1000,
      onError: handleLoadError,
    },
  )

  useEffect(() => {
    // Back/forward or in-app page links that change the query string of this
    // page re-fetch with the new params.
    const path = window.location.pathname
    const onLocation = () => {
      if (suppressLocation.current) return
      if (window.location.pathname === path && window.location.search !== lastSearch.current) {
        void refresh()
      }
    }
    window.addEventListener('popstate', onLocation)
    window.addEventListener('aiui:locationchange', onLocation)
    return () => {
      window.removeEventListener('popstate', onLocation)
      window.removeEventListener('aiui:locationchange', onLocation)
      actionAbort.current?.abort()
      actionAbort.current = null
    }
  }, [endpoint, refresh])

  const runAction = useCallback(
    async (req: BlockActionRequest): Promise<boolean> => {
      const { body, label } = req
      if (req.method === 'get') {
        writeUrlGuarded(() => writeParams(body))
        await refresh()
        return true
      }
      const failTitle = label ? `${label} failed` : 'Action failed'
      actionAbort.current?.abort()
      const ac = new AbortController()
      actionAbort.current = ac
      try {
        const res = await fetch(postUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/x-ndjson, application/json',
          },
          credentials: 'same-origin',
          body: JSON.stringify(actionBodyWithParams(body, window.location.search)),
          signal: ac.signal,
        })
        if (res.ok && isNdjsonContentType(res.headers.get('content-type')) && res.body) {
          setStreaming(true)
          let ok = true
          let sawTree = false
          let lastMessage = ''
          try {
            await readNdjsonStream(
              res.body,
              (frame) => {
                if (ac.signal.aborted) return
                if (isRecord(frame) && str(frame.error)) {
                  ok = false
                  void notify(failTitle, { type: 'error', description: errorText(frame) })
                  return
                }
                const message = isRecord(frame) ? str(frame.message ?? frame.status) : ''
                writeUrlGuarded(() => writeUrlFrom(frame, req))
                if (hasBlockTree(frame)) {
                  sawTree = true
                  setData(parseBlockPageData(frame))
                } else {
                  applyDynamicManifest(frame)
                }
                if (message) lastMessage = message
              },
              ac.signal,
            )
          } finally {
            if (actionAbort.current === ac) {
              actionAbort.current = null
              setStreaming(false)
            }
          }
          if (ac.signal.aborted) return false
          if (ok && (lastMessage || !sawTree)) {
            void notify(lastMessage || (label ? `${label}: done` : 'Done'), { type: 'success' })
          }
          return ok
        }
        const data = await readJson(res)
        if (!res.ok || (isRecord(data) && str(data.error))) {
          void notify(failTitle, { type: 'error', description: errorText(data, res) })
          return false
        }
        const message = isRecord(data) ? str(data.message ?? data.status) : ''
        writeUrlGuarded(() => writeUrlFrom(data, req))
        if (hasBlockTree(data)) {
          setData(parseBlockPageData(data))
          if (message) void notify(message, { type: 'success' })
        } else {
          applyDynamicManifest(data)
          void notify(message || (label ? `${label}: done` : 'Done'), { type: 'success' })
        }
        return true
      } catch (err) {
        if (ac.signal.aborted) return false
        void notify(failTitle, { type: 'error', description: describe(err) })
        return false
      } finally {
        if (actionAbort.current === ac) actionAbort.current = null
      }
    },
    [postUrl, refresh, setData, writeUrlGuarded],
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

  const status: 'loading' | 'ready' | 'error' = pageData !== undefined ? 'ready' : loading ? 'loading' : 'error'
  const version = updatedAt ?? 0
  const ctx = useMemo<BlockContextValue>(
    () => ({ page, runAction, loadSection, version }),
    [page, runAction, loadSection, version],
  )

  return (
    <BlockContext.Provider value={ctx}>
      <div
        className="aiui-block-page flex min-w-0 flex-col gap-6"
        data-page={page.id}
        data-status={status}
        aria-busy={status === 'loading' || refreshing || undefined}
      >
        <div className="-mb-2 flex min-h-8 items-center justify-end gap-2 text-xs text-muted-foreground">
          {streaming && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              aria-label="Stop streaming"
              onClick={() => actionAbort.current?.abort()}
            >
              <span aria-hidden className="size-2.5 rounded-[2px] bg-current" />
              Stop
            </Button>
          )}
          {status === 'ready' && updatedAt !== null && (
            <span className="tabular-nums" title={new Date(updatedAt).toISOString()}>
              Updated {formatTime(updatedAt)}
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Refresh ${page.title}`}
            title="Refresh"
            disabled={refreshing || status === 'loading'}
            onClick={() => void refresh()}
          >
            <RefreshCw aria-hidden className={cn(refreshing && 'animate-spin motion-reduce:animate-[spin_1.6s_linear_infinite]')} />
          </Button>
        </div>

        {status === 'loading' && <LoadingSkeleton />}

        {status === 'error' && (
          <div role="alert" className="flex min-w-0 flex-col items-start gap-3 rounded-xl border border-border px-5 py-4">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <CircleX aria-hidden className="size-4 text-destructive" />
              Couldn't load {page.title}
            </div>
            <p className="break-words text-xs text-muted-foreground">{pageError ? describe(pageError) : 'Request failed'}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              Try again
            </Button>
          </div>
        )}

        {status === 'ready' &&
          pageData &&
          (pageData.nodes.length > 0 ? (
            <BlockList nodes={pageData.nodes} page={page} />
          ) : (
            <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
              This page has no content yet.
            </div>
          ))}
      </div>
    </BlockContext.Provider>
  )
}

;(BlockPage as typeof BlockPage & { Preview: typeof ComponentPreview; preloadBlocks: typeof preloadCoreBlockTypes }).Preview = ComponentPreview
;(BlockPage as typeof BlockPage & { preloadBlocks: typeof preloadCoreBlockTypes }).preloadBlocks = preloadCoreBlockTypes
;(globalThis as { __aiuiComponentPreview?: typeof ComponentPreview; __aiuiPreloadPreviewBlocks?: typeof preloadCoreBlockTypes }).__aiuiComponentPreview = ComponentPreview
;(globalThis as { __aiuiPreloadPreviewBlocks?: typeof preloadCoreBlockTypes }).__aiuiPreloadPreviewBlocks = preloadCoreBlockTypes

/**
 * Live interactive UI component preview for documentation pages (`<ComponentPreview>`).
 * Colocated with BlockPage so DocsBlocks.tsx reuses the existing lazy BlockPage chunk
 * without splitting shell/mount or adding any bytes to first paint (R4, R10).
 */
export function ComponentPreview({ title, spec }: { title?: string; spec?: string }): JSX.Element {
  const [lastAction, setLastAction] = useState<string | null>(null)

  const { nodes, parseError } = useMemo(() => {
    if (!spec || !spec.trim()) return { nodes: [], parseError: null }
    try {
      const parsed: unknown = JSON.parse(spec)
      return { nodes: toBlockNodes(parsed), parseError: null }
    } catch (err) {
      return {
        nodes: [],
        parseError: err instanceof Error ? err.message : 'Invalid JSON preview spec',
      }
    }
  }, [spec])

  const ctx = useMemo<BlockContextValue>(
    () => ({
      async runAction(req: BlockActionRequest) {
        const label = req.label ? `${req.label} ` : ''
        setLastAction(`${label}${JSON.stringify(req.body)}`)
        return true
      },
    }),
    [],
  )

  return (
    <div
      data-aiui-component-preview=""
      className="not-prose my-4 min-w-0 overflow-hidden rounded-xl border border-hairline bg-card"
    >
      <div className="flex items-center justify-between gap-2 border-b border-hairline bg-fill-4 px-3 py-2 text-xs">
        <span className="font-medium text-tier-1">{title || 'Live Preview'}</span>
        <span className="text-tier-3">Interactive</span>
      </div>
      <div className="flex min-w-0 flex-col gap-3 overflow-x-auto p-4">
        {parseError ? (
          <p className="text-xs text-destructive">Preview error: {parseError}</p>
        ) : nodes.length === 0 ? (
          <p className="text-xs text-tier-3">Empty preview.</p>
        ) : (
          <BlockContext.Provider value={ctx}>
            <BlockList nodes={nodes} />
          </BlockContext.Provider>
        )}
      </div>
      {lastAction && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 border-t border-hairline bg-fill-4 px-3 py-1.5 font-mono text-xs text-tier-2"
        >
          <span className="truncate">Action: {lastAction}</span>
          <button
            type="button"
            onClick={() => setLastAction(null)}
            className="shrink-0 font-sans text-tier-3 hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
