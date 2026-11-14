/**
 * Slot host: renders every component registered for a slot name with
 * `registerSlot` (@aiui/sdk), in `order`. The shell places hosts at
 *
 *   header:actions       the header bar, before search and the mode toggle
 *   sidebar:footer       the bottom of the sidebar (desktop and phone sheet)
 *   page:<id>:toolbar    above the body of page <id>
 *
 * A host with no contribution renders nothing at all, so an app without slot
 * plugins looks exactly as before. Each contribution sits in its own error
 * boundary and Suspense: one that throws (or is still loading) never takes
 * the others, or the chrome around them, down.
 */
import { Component, createElement, Suspense, type ErrorInfo, type ReactNode } from 'react'
import { getSlotContributions, useRegistryVersion } from '@/sdk/registry'
import type { ShellPage } from '@/sdk/manifest'

/** Slot names the shell hosts. `pageToolbar(id)` builds the per-page name. */
export const SHELL_SLOTS = Object.freeze({
  headerActions: 'header:actions',
  sidebarFooter: 'sidebar:footer',
  pageToolbar: (pageId: string) => `page:${pageId}:toolbar`,
})

/** Props every slot contribution receives (hosts may add more). */
export interface SlotProps {
  /** The slot name this component was registered for. */
  slot: string
  /** Id of the page on screen ('' at the site root). */
  pageId: string
  /** Manifest entry of that page, when the manifest lists it. */
  page?: ShellPage
}

interface BoundaryProps {
  slot: string
  id: string
  children: ReactNode
}

export class SlotBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(
      `[aiui shell] slot '${this.props.slot}' contribution '${this.props.id}' failed to render`,
      error,
      info.componentStack,
    )
  }

  render() {
    // A broken contribution is dropped; the rest of the slot stays.
    return this.state.failed ? null : this.props.children
  }
}

const componentKeys = new WeakMap<object, number>()
let nextComponentKey = 0

/** A stable number per component identity (function, or memo/lazy object). */
function componentKey(component: unknown): number {
  const target = component as object
  let key = componentKeys.get(target)
  if (key === undefined) componentKeys.set(target, (key = nextComponentKey += 1))
  return key
}

export function Slot({
  name,
  pageId,
  page,
  extra,
  className,
}: {
  name: string
  pageId: string
  page?: ShellPage
  /** Host-specific props passed to every contribution. */
  extra?: Record<string, unknown>
  className?: string
}) {
  // Plugin modules register after the first paint.
  useRegistryVersion()
  const contributions = getSlotContributions(name)
  if (contributions.length === 0) return null
  return (
    <div data-aiui-slot={name} className={className}>
      {contributions.map((c) => (
        // The key includes the component: a re-registration remounts, which
        // also clears a boundary that had failed.
        <SlotBoundary key={`${c.id}:${componentKey(c.component)}`} slot={name} id={c.id}>
          <Suspense fallback={null}>{createElement(c.component, { ...extra, slot: name, pageId, page })}</Suspense>
        </SlotBoundary>
      ))}
    </div>
  )
}
