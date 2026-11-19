// Error boundaries for the docs App's lazy parts. A lazy chunk that cannot
// load (a deploy removed it under an open page, a dropped connection) throws
// while rendering; with no boundary React unmounts the whole page and the
// reader sees a blank screen. Optional extras (feedback, related pages, search,
// Ask AI) disappear on their own instead; anything else ends on a message with
// Reload, never a blank page.
import { Component, Suspense, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

class Boundary extends Component<{ name: string; fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
    state = { failed: false }
    static getDerivedStateFromError() {
        return { failed: true }
    }
    componentDidCatch(error: unknown) {
        console.warn(`[aiui docs] ${this.props.name} failed to load or render`, error)
    }
    render() {
        return this.state.failed ? this.props.fallback : this.props.children
    }
}

/** A lazy extra that may fail alone: nothing while it loads, nothing if it cannot. */
export function OptionalPart({ name, children }: { name: string; children: ReactNode }) {
    return (
        <Boundary name={name} fallback={null}>
            <Suspense fallback={null}>{children}</Suspense>
        </Boundary>
    )
}

/**
 * Reload past the caches: the same URL with `?aiui-build=` (the parameter
 * chunkReload.ts uses; main.tsx strips it at boot). Not imported from
 * chunkReload.ts: that module lives in the entry chunk.
 */
function reloadPastCaches() {
    const url = new URL(window.location.href)
    url.searchParams.set('aiui-build', String(Date.now()))
    window.location.replace(url.toString())
}

/** The last line of defence around the docs App: a message with Reload instead of a blank page. */
export function DocsErrorBoundary({ children }: { children: ReactNode }) {
    const fallback = (
        <div role="alert" className="flex flex-col items-center justify-center min-h-screen gap-4 bg-background">
            <h2 className="text-xl font-semibold">Part of this page failed to load</h2>
            <p className="text-muted-foreground">A new version may have been published. Reload to get it.</p>
            <Button type="button" variant="outline" onClick={reloadPastCaches}>Reload</Button>
        </div>
    )
    return <Boundary name="the page" fallback={fallback}>{children}</Boundary>
}
