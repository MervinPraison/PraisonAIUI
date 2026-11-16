/**
 * An A2UI surface artifact: the chat's own surface part (a lazy chunk that
 * loads the optional @a2ui packages on demand), fed every message of the
 * surface up to this version.
 */
import { lazy, Suspense, useMemo, type JSX } from 'react'

const A2uiPart = lazy(() => import('@/chat-engine/parts/A2uiPart'))

export default function A2uiViewer({ content, surfaceId, sessionId }: { content: string; surfaceId: string; sessionId?: string }): JSX.Element {
  const messages = useMemo(() => {
    try {
      const v: unknown = JSON.parse(content)
      return Array.isArray(v) ? (v as Record<string, unknown>[]) : []
    } catch {
      return []
    }
  }, [content])
  if (!messages.length) return <p className="text-sm text-tier-3">This view has nothing to show.</p>
  return (
    <Suspense fallback={<div className="h-24 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />}>
      <A2uiPart data={{ surface_id: surfaceId, messages }} sessionId={sessionId} />
    </Suspense>
  )
}
