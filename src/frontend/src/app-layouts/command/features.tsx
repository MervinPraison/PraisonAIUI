/**
 * The Command Deck's layout features, each its own lazy chunk (R17: a layout
 * loads features with import() only): the command bar (`lf-command-bar`)
 * and the run inspector (`lf-run-inspector`). A chunk that fails to load or
 * a feature that throws shows its fallback; the frame itself stays up.
 */
import { Component, Suspense, type ComponentProps, type ReactNode } from 'react'
import { retryableLazy } from '@/lib/retryableLazy'

export const CommandBar = retryableLazy(() => import('@/layout-features/command-bar/CommandBar'))
export const RunInspector = retryableLazy(() => import('@/layout-features/run-inspector/RunInspector'))

export type CommandBarProps = ComponentProps<typeof CommandBar>
export type RunInspectorProps = ComponentProps<typeof RunInspector>

class Boundary extends Component<{ name: string; fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.error(`[aiui] command layout: ${this.props.name} failed`, err)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** A feature in its own Suspense and error boundary; `fallback` while it loads and if it fails. */
export function Feature({ name, fallback = null, children }: { name: string; fallback?: ReactNode; children: ReactNode }) {
  return (
    <Boundary name={name} fallback={fallback}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </Boundary>
  )
}
