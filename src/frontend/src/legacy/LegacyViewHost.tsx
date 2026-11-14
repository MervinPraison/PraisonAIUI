/**
 * Hosts one legacy dashboard page (plugins/views/*.js, window.aiui.registerView,
 * dashboard-plugins) inside the React shell (ADR-0001 §2.3).
 *
 * React renders an empty host element. An effect appends the mount node
 * (`.aiui-legacy-mount#db-page-content`) imperatively, so React never
 * reconciles DOM the legacy view writes with innerHTML. Unmount order: abort
 * the pending mount, run the view's cleanup, then remove the node. Safe under
 * StrictMode's double mount.
 *
 * Contract (ADR-0001 §5): LegacyViewHost(p: { pageId: string; page?: ShellPage })
 */
import { useEffect, useRef, useState, type JSX } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { ShellPage } from '../sdk/manifest'
// Also imported by runtime.ts (overlays before the first mount); Vite dedupes.
import './bridge.css'
import { ensureLegacyRuntime } from './runtime'

export interface LegacyViewHostProps {
  pageId: string
  page?: ShellPage
  className?: string
}

type HostStatus = 'loading' | 'ready' | 'error'

/**
 * Legacy pages that size themselves to the viewport and need the full content
 * area: the manifest says so (`layout: 'full-bleed'`), never the page id.
 */
function isFullBleedPage(page?: Pick<ShellPage, 'layout'>): boolean {
  return page?.layout === 'full-bleed'
}

export function LegacyViewHost({ pageId, page, className }: LegacyViewHostProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  // Bumped to re-mount: a late registerView() for this page, or Retry.
  const [generation, setGeneration] = useState(0)
  // Status of one mount attempt. An attempt whose key is not the current one
  // is still loading, so a new page or generation never shows a stale status.
  const mountKey = `${pageId}\u0000${generation}`
  const [result, setResult] = useState<{ key: string; status: HostStatus }>({ key: '', status: 'loading' })
  const status: HostStatus = result.key === mountKey ? result.status : 'loading'

  // The latest page object without making its identity a re-mount trigger.
  const pageRef = useRef(page)
  useEffect(() => {
    pageRef.current = page
  }, [page])

  useEffect(() => {
    const onRegistered = (e: Event) => {
      if ((e as CustomEvent<{ pageId?: unknown }>).detail?.pageId === pageId) setGeneration((g) => g + 1)
    }
    window.addEventListener('aiui:view-registered', onRegistered)
    return () => window.removeEventListener('aiui:view-registered', onRegistered)
  }, [pageId])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const key = `${pageId}\u0000${generation}`
    const mount = document.createElement('div')
    mount.className = 'aiui-legacy-mount'
    mount.id = 'db-page-content' // legacy CSS and views key off this id
    host.appendChild(mount)

    const controller = new AbortController()
    let cleanup: (() => void) | null = null

    ensureLegacyRuntime()
      .then((runtime) => runtime.mountView(pageId, mount, { page: pageRef.current, signal: controller.signal }))
      .then((viewCleanup) => {
        if (controller.signal.aborted) {
          viewCleanup()
          return
        }
        cleanup = viewCleanup
        setResult({ key, status: 'ready' })
        window.dispatchEvent(new CustomEvent('aiui:page-change', { detail: { pageId, page: pageRef.current } }))
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        console.warn(`[LegacyViewHost] '${pageId}' failed to mount`, err)
        setResult({ key, status: 'error' })
      })

    return () => {
      controller.abort()
      try {
        cleanup?.()
      } catch (err) {
        console.warn(`[LegacyViewHost] cleanup '${pageId}' failed`, err)
      }
      mount.remove()
    }
  }, [pageId, generation])

  const title = page?.title || pageId
  const classes = ['aiui-legacy-host', isFullBleedPage(page) ? 'db-fill' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <>
      {status === 'loading' && (
        <div className="aiui-legacy-loading" aria-hidden="true">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-full max-w-xl" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}
      {status === 'error' && (
        <div role="alert" className="aiui-legacy-error">
          <p>
            Couldn&apos;t load <strong>{title}</strong>. Check your connection, then try again.
          </p>
          <Button variant="outline" size="sm" onClick={() => setGeneration((g) => g + 1)}>
            Retry
          </Button>
        </div>
      )}
      {/* React renders no children into this element; the legacy view owns them. */}
      <div
        ref={hostRef}
        className={classes}
        data-legacy-page={pageId}
        data-status={status}
        aria-busy={status === 'loading'}
      />
    </>
  )
}

export default LegacyViewHost
