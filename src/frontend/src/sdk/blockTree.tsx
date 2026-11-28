/**
 * Lazy `<BlockTree>` wrapper for `@aiui/sdk`.
 *
 * Lets React plugins and custom layouts render any built-in or plugin-registered
 * `BlockNode` (or sibling array) without pulling `blocks/` into the shell boot
 * closure (R4, R10). Isolates chunk load failures behind an error boundary so
 * a broken or stale lazy chunk never crashes the host page.
 */
import { Component, Suspense, type ComponentType, type ErrorInfo, type JSX, type ReactNode } from 'react'
import { retryableLazy, retryFailedLazies } from '@/lib/retryableLazy'
import type { ShellPage } from './manifest'
import type { BlockNode } from './registry'

export interface BlockTreeAction {
  readonly body: Record<string, unknown>
  readonly label?: string
  readonly method?: 'get' | 'post'
  readonly updateUrl?: boolean
}

export interface BlockTreeProps {
  /** A single block node or an array of sibling block nodes to render. */
  node: BlockNode | readonly BlockNode[]
  /** Optional page descriptor passed to block renderers. */
  page?: ShellPage
  /**
   * Optional handler for interactive block actions (buttons, forms, row actions).
   * Return `false` to indicate the action did not succeed.
   */
  onAction?: (req: BlockTreeAction) => boolean | void | Promise<boolean | void>
  /** Optional placeholder rendered while the lazy blocks engine loads. */
  fallback?: ReactNode
}

type InnerProps = Omit<BlockTreeProps, 'fallback'>

let Loaded: ComponentType<InnerProps> | null = null
let pending: Promise<{ default: ComponentType<InnerProps> }> | null = null

function loadBlockTree() {
  pending ??= import('@/blocks/BlockRenderer')
    .then((m) => {
      Loaded = m.BlockTreeView as ComponentType<InnerProps>
      return { default: Loaded }
    })
    .catch((err: unknown) => {
      pending = null
      throw err
    })
  return pending
}

const LazyBlockTree = retryableLazy<InnerProps>(loadBlockTree)

class BlockTreeBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props)
    retryFailedLazies()
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('[aiui sdk] BlockTree renderer failed to load', error, info.componentStack)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function BlockTree({ fallback = null, ...props }: BlockTreeProps): JSX.Element {
  const Ready = Loaded
  return (
    <BlockTreeBoundary fallback={fallback}>
      {Ready ? (
        <Ready {...props} />
      ) : (
        <Suspense fallback={fallback}>
          <LazyBlockTree {...props} />
        </Suspense>
      )}
    </BlockTreeBoundary>
  )
}
