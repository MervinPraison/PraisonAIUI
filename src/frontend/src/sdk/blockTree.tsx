/**
 * Lazy `<BlockTree>` wrapper for `@aiui/sdk`.
 *
 * Lets React plugins and custom layouts render any built-in or plugin-registered
 * `BlockNode` (or sibling array) without pulling `blocks/` into the shell boot
 * closure (R4, R10).
 */
import { Suspense, type ComponentType, type JSX, type ReactNode } from 'react'
import { retryableLazy } from '@/lib/retryableLazy'
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

export function BlockTree({ fallback = null, ...props }: BlockTreeProps): JSX.Element {
  const Ready = Loaded
  if (Ready) return <Ready {...props} />
  return (
    <Suspense fallback={fallback}>
      <LazyBlockTree {...props} />
    </Suspense>
  )
}
