/**
 * Renders a BlockNode. Every React renderer, first-party included, comes from
 * the SDK block registry. Resolution order for `node.type`:
 *   1. a block registered with `registerBlock(type, C)` (plugins)
 *   2. a custom.js renderer (`window.aiui.registerComponent`), which also
 *      overrides core types on the legacy dashboard
 *   3. a block registered with `{ fallback: true }`: the core blocks
 *      (coreBlocks.tsx registers itself when this chunk loads)
 *   4. the legacy dashboard renderer (LegacyBlockFallback)
 * Each block is isolated by an error boundary: one broken block never takes
 * the page down.
 */
import { Component, createElement, Suspense, type ErrorInfo, type JSX, type ReactNode } from 'react'
import { CircleX } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import type { ShellPage } from '@/sdk/manifest'
import { getBlock, isFallbackBlock, useRegistryVersion, type BlockNode } from '@/sdk/registry'
// Side effect: registers the core blocks as fallbacks in the SDK registry.
import './coreBlocks'
import { hasLegacyCustomComponent, LegacyBlockFallback } from './LegacyBlockFallback'

export interface BlockRendererProps {
  node: BlockNode
  page?: ShellPage
}

interface BoundaryProps {
  type: string
  /** A new node (e.g. after an action replaced the tree) clears the error. */
  resetKey: unknown
  children: ReactNode
}

class BlockBoundary extends Component<BoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.warn(`[aiui blocks] block '${this.props.type}' failed to render`, error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        role="alert"
        data-aiui-block-error={this.props.type}
        className="flex min-w-0 items-start gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-xs text-muted-foreground"
      >
        <CircleX aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
        <span className="min-w-0 break-words">
          Block <code className="font-mono">{this.props.type}</code> failed to render: {this.state.error.message}
        </span>
      </div>
    )
  }
}

export function BlockRenderer({ node, page }: BlockRendererProps): JSX.Element {
  // Re-render when a plugin registers a block after this page painted.
  useRegistryVersion()
  const Registered = getBlock(node.type)
  let content: JSX.Element
  if (Registered && !(isFallbackBlock(node.type) && hasLegacyCustomComponent(node.type))) {
    // createElement: the component comes from a lookup table, not from render.
    content = (
      <Suspense fallback={<Skeleton className="h-16 w-full" />}>
        {createElement(Registered, { node, page })}
      </Suspense>
    )
  } else {
    // A custom.js renderer for a core type, or a type nothing is registered for.
    content = <LegacyBlockFallback node={node} />
  }
  return (
    <BlockBoundary type={node.type} resetKey={node}>
      {content}
    </BlockBoundary>
  )
}

/** A list of sibling blocks (no wrapper element). */
export function BlockList({ nodes, page }: { nodes: BlockNode[]; page?: ShellPage }): JSX.Element {
  return (
    <>
      {nodes.map((node, i) => (
        <BlockRenderer key={i} node={node} page={page} />
      ))}
    </>
  )
}
