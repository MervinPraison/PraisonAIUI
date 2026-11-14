/**
 * Page resolution (ADR-0001 §2.3), in order:
 *   1. the SDK registry (ported pages, plugin pages; lazy-aware)
 *   2. kind === 'blocks'  → BlockPage (WP7), unless custom.js / a dashboard-plugin
 *      registered a client view for the id (`window.aiui.registerView`): that
 *      takes priority over the server handler, as in the legacy dashboard
 *   3. kind === 'iframe'  → sandboxed iframe of page.module
 *   4. everything else    → LegacyViewHost (WP4)
 * LegacyViewHost and BlockPage are lazy chunks: neither enters the shell's
 * boot closure. Each page renders inside its own error boundary + Suspense.
 * Above the body sits the `page:<id>:toolbar` slot (empty unless a plugin
 * contributes to it).
 */
import { Component, createElement, Fragment, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { CircleAlert, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getPage, useRegistryVersion } from '@/sdk/registry'
import type { LegacyViewHostProps } from '@/legacy/LegacyViewHost'
import type { ShellPage } from '@/sdk/manifest'
import { retryableLazy, retryFailedLazies } from '@/lib/retryableLazy'
import { cn } from '@/lib/utils'
import { useLegacyViewRegistered } from './legacyViews'
import { usesLegacyHost } from './nav'
import { EmptyState, PageSkeleton } from './primitives'
import { isPlainLeftClick, navigate, PAGE_CHANGE_EVENT, pathForPage } from './router'
import { SHELL_SLOTS, Slot } from './Slot'

// Retryable: one failed chunk load (offline, a deploy) must not break every
// later page of that kind; Try again, or the next page, imports again.
const LegacyViewHost = retryableLazy<LegacyViewHostProps>(() =>
  import('@/legacy/LegacyViewHost').then((m) => ({ default: m.LegacyViewHost })),
)
const BlockPage = retryableLazy<{ page: ShellPage }>(() => import('@/blocks/BlockPage'))

/** Tell legacy listeners (approvals, prefill-composer callers) a React page is on screen. */
function PageMounted({ pageId, page }: { pageId: string; page?: ShellPage }) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(PAGE_CHANGE_EVENT, { detail: { pageId, page } }))
    // page identity is not a re-announce trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId])
  return null
}

interface BoundaryProps {
  pageTitle: string
  children: ReactNode
}

class PageErrorBoundary extends Component<BoundaryProps, { error: Error | null; attempt: number }> {
  state: { error: Error | null; attempt: number } = { error: null, attempt: 0 }

  constructor(props: BoundaryProps) {
    super(props)
    // A new page: chunks that failed on an earlier page (offline) load again.
    retryFailedLazies()
  }

  private retry = () => {
    retryFailedLazies()
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))
  }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[aiui shell] page "${this.props.pageTitle}" crashed`, error, info.componentStack)
  }

  render() {
    const { error, attempt } = this.state
    // Try again remounts the page (a fresh lazy import after a failed load).
    if (!error) return <Fragment key={attempt}>{this.props.children}</Fragment>
    return (
      <EmptyState
        role="alert"
        icon={<CircleAlert />}
        title={`“${this.props.pageTitle}” failed to load`}
        description={error.message || 'An unexpected error occurred while rendering this page.'}
      >
        <Button variant="outline" size="sm" onClick={this.retry}>
          Try again
        </Button>
        <Button variant="ghost" size="sm" onClick={() => window.location.reload()}>
          Reload page
        </Button>
      </EmptyState>
    )
  }
}

function IframePage({ page }: { page: ShellPage }) {
  if (!page.module) {
    return <EmptyState icon={<FileText />} title={page.title} description="This page has no address to display." />
  }
  return (
    <iframe
      src={page.module}
      title={page.title}
      // Never allow-same-origin together with allow-scripts: plugin iframes are
      // served same-origin (/_plugins/...), so that pair would undo the sandbox.
      sandbox="allow-scripts allow-forms allow-popups allow-downloads"
      referrerPolicy="no-referrer"
      className="block size-full min-h-0 flex-1 border-0 bg-background"
    />
  )
}

function GoToFirstPage({ firstPage }: { firstPage?: ShellPage }) {
  if (!firstPage) return null
  return (
    <Button asChild variant="outline" size="sm">
      <a
        href={pathForPage(firstPage.id)}
        onClick={(e) => {
          if (!isPlainLeftClick(e)) return
          e.preventDefault()
          navigate(firstPage.id)
        }}
      >
        Go to {firstPage.title}
      </a>
    </Button>
  )
}

export function PageView({
  pageId,
  page,
  pluginsSettled,
  fullBleed,
  firstPage,
}: {
  pageId: string
  page: ShellPage | undefined
  pluginsSettled: boolean
  fullBleed: boolean
  firstPage?: ShellPage
}) {
  // Late registerPage() calls (plugins) re-render the resolution.
  useRegistryVersion()
  const Registered = pageId ? getPage(pageId) : undefined
  const title = page?.title ?? pageId
  const clientView = useLegacyViewRegistered(pageId, !Registered && page?.kind === 'blocks')

  let body: ReactNode = null
  let announce = true
  if (!pageId) {
    // `/` before the redirect to the default page.
    announce = false
    body = firstPage ? (
      <PageSkeleton fill={fullBleed} />
    ) : (
      <EmptyState icon={<FileText />} title="No pages" description="This server has no pages enabled." />
    )
  } else if (Registered) {
    body = createElement(Registered, { page: page ?? { id: pageId, title: pageId, kind: 'react' } })
  } else if (!page) {
    announce = false
    body = pluginsSettled ? (
      <EmptyState
        icon={<FileText />}
        title="Page not found"
        description={
          <>
            There is no page called <code className="font-mono text-foreground">{pageId}</code> on this server.
          </>
        }
      >
        <GoToFirstPage firstPage={firstPage} />
      </EmptyState>
    ) : (
      <PageSkeleton fill={fullBleed} />
    )
  } else if (page.kind === 'blocks' && clientView) {
    // LegacyViewHost announces aiui:page-change itself once the view is mounted.
    announce = false
    body = <LegacyViewHost key={pageId} pageId={pageId} page={page} />
  } else if (page.kind === 'blocks') {
    body = <BlockPage page={page} />
  } else if (page.kind === 'iframe') {
    body = <IframePage page={page} />
  } else if (page.kind === 'react') {
    // A plugin page whose module has not registered (yet, or ever).
    announce = false
    body = pluginsSettled ? (
      <EmptyState
        role="alert"
        icon={<CircleAlert />}
        title={`“${title}” is unavailable`}
        description="The plugin that provides this page did not load. Check the server log or run `aiui plugins doctor`."
      >
        <GoToFirstPage firstPage={firstPage} />
      </EmptyState>
    ) : (
      <PageSkeleton fill={fullBleed} />
    )
  } else if (usesLegacyHost(page)) {
    // LegacyViewHost announces aiui:page-change itself once the view is mounted.
    announce = false
    body = <LegacyViewHost key={pageId} pageId={pageId} page={page} />
  }

  return (
    <PageErrorBoundary key={pageId} pageTitle={title}>
      <div
        data-aiui-page={pageId}
        className={cn(
          'w-full min-w-0',
          fullBleed ? 'flex min-h-0 flex-1 flex-col' : 'px-4 py-4 md:px-8 md:py-6 lg:px-10 lg:py-8',
        )}
      >
        {page && (
          <Slot
            name={SHELL_SLOTS.pageToolbar(pageId)}
            pageId={pageId}
            page={page}
            className={cn(
              'flex shrink-0 flex-wrap items-center justify-end gap-2',
              fullBleed ? 'border-b border-border px-4 py-2' : 'pb-4',
            )}
          />
        )}
        <Suspense fallback={<PageSkeleton fill={fullBleed} />}>
          {body}
          {announce && <PageMounted pageId={pageId} page={page} />}
        </Suspense>
      </div>
    </PageErrorBoundary>
  )
}
