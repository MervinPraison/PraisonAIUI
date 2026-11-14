/**
 * Suspense + error boundary for the chat's lazy parts (elements, ask prompts,
 * A2UI surfaces). A chunk that fails to load (or a renderer that throws) shows
 * a small placeholder instead of taking the whole thread down.
 */
import { Component, Suspense, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Shown while the chunk loads. */
  fallback?: ReactNode
  /** Shown when the chunk fails to load or the part throws. */
  failed?: ReactNode
}

class Boundary extends Component<{ children: ReactNode; failed: ReactNode }, { error: boolean }> {
  state = { error: false }

  static getDerivedStateFromError() {
    return { error: true }
  }

  componentDidCatch(error: unknown) {
    console.warn('[aiui chat] a message part failed to render', error)
  }

  render() {
    return this.state.error ? this.props.failed : this.props.children
  }
}

export function LazyBoundary({ children, fallback = null, failed }: Props) {
  return (
    <Boundary
      failed={
        failed ?? (
          <div className="my-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            This part could not be displayed.
          </div>
        )
      }
    >
      <Suspense fallback={fallback}>{children}</Suspense>
    </Boundary>
  )
}
