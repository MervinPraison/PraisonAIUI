/**
 * Host for a layout's chat regions (`meta.chat.aside`, `turnHeader`,
 * `turnFooter`, `empty`; ADR 0003 §1.3): the region's loader runs the first
 * time the region is on screen, inside Suspense and an error boundary, so a
 * region that fails to load or throws disappears on its own (logged) and the
 * chat keeps working (R4).
 *
 * This module is itself a lazy chunk of the chat page: without a layout that
 * declares regions it is never downloaded.
 */
import { Component, lazy, Suspense, type ComponentType, type JSX, type LazyExoticComponent, type ReactNode } from 'react'

type Loader<P> = () => Promise<{ default: ComponentType<P> }>
// Regions of any props share one cache; each call site keeps its own P.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyComponent = ComponentType<any>

interface Entry {
  component: LazyExoticComponent<AnyComponent>
  /** Remounts the boundary when the loader changes (another layout). */
  key: number
}

// One lazy component per loader: React.lazy must not be re-created per render.
const components = new WeakMap<object, Entry>()
let seq = 0

function entryOf<P>(loader: Loader<P>): Entry {
  let e = components.get(loader)
  if (!e) {
    e = { component: lazy(loader as () => Promise<{ default: AnyComponent }>), key: ++seq }
    components.set(loader, e)
  }
  return e
}

class RegionBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.warn(`[aiui chat] the layout's ${this.props.name} region failed to load or render`, error)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

export interface LazyRegionProps<P> {
  loader: Loader<P>
  props: P
  /** For the log line: aside, turnHeader, turnFooter, empty. */
  name: string
  fallback?: ReactNode
}

export default function LazyRegion<P extends object>({ loader, props, name, fallback = null }: LazyRegionProps<P>): JSX.Element {
  const entry = entryOf(loader)
  const C = entry.component as ComponentType<P>
  return (
    // A new loader (another layout) gets a fresh boundary.
    <RegionBoundary key={entry.key} name={name}>
      <Suspense fallback={fallback}>
        {/* display: contents; marks the region for the variant styles (steps.css). */}
        <div className="contents" data-chat-region={name}>
          <C {...props} />
        </div>
      </Suspense>
    </RegionBoundary>
  )
}
