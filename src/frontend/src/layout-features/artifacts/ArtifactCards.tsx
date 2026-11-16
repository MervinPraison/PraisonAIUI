/**
 * Cards under an assistant turn (a layout's chat `turnFooter` region,
 * TurnRegionProps) for the artifacts that reply made: "Comparison table ·
 * Table · 3 rows · v2 · edited by Researcher · In canvas". A card opens the
 * artifact in the canvas (ArtifactsStore.open, which also dispatches
 * `aiui:artifact-open` so the frame can bring its canvas up, e.g. the phone
 * switch); while the `artifacts` page is listed its link is the share link,
 * so a modified click opens that page in a new tab (otherwise it is a
 * button). Nothing renders for a reply without artifacts. The reply's own
 * blocks that are these artifacts are marked for the layout to hide
 * (./inChat), so an artifact shows once: as its card here, in full in the canvas.
 *
 *   turnFooter: () => import('@/layout-features/artifacts/ArtifactCards')
 */
import { useRef, type JSX, type MouseEvent } from 'react'
import { ArrowUpRight } from 'lucide-react'
import type { TurnRegionProps } from '@/sdk/layouts'
import { cn } from '@/lib/utils'
import type { DerivedArtifact } from './derive'
import { artifactsStore } from './feed'
import { cardMeta, shareUrl } from './format'
import { canShare, useArtifacts, useCanRun } from './hooks'
import { useMarkInCanvas } from './inChat'
import { KindIcon } from './viewers/Viewer'

const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey

export function ArtifactCard({ artifact: a, latest, touch, onOpen }: {
  artifact: DerivedArtifact
  /** The key's latest version (the card says when it is newer). */
  latest?: DerivedArtifact
  touch?: boolean
  onOpen(): void
}): JSX.Element {
  const file = a.kind === 'code' && a.key === a.title
  const href = a.sessionId && canShare() ? shareUrl(a, '') : undefined
  const runnable = useCanRun(a.kind === 'code' ? a.language : undefined)
  const newer = latest && latest.version > a.version ? latest.version : null
  return (
    <a
      href={href}
      role={href ? undefined : 'button'}
      tabIndex={href ? undefined : 0}
      onClick={(e) => {
        if (href && !plainClick(e)) return
        e.preventDefault()
        onOpen()
      }}
      onKeyDown={(e) => {
        if (!href && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onOpen()
        }
      }}
      aria-label={`Open ${a.title} in the canvas`}
      className={cn(
        'flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-foreground no-underline outline-none hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring',
        touch && 'min-h-14',
      )}
      data-artifact-card={a.key}
    >
      <span aria-hidden className="grid size-8.5 shrink-0 place-items-center rounded-lg bg-sidebar text-link">
        <KindIcon kind={a.kind} className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={cn('truncate text-base font-semibold', file && 'font-mono text-sm font-medium')}>{a.title}</span>
        <span className="truncate text-xs text-tier-3">
          {cardMeta(a, { runnable, compact: touch })}
          {newer && ` · v${newer} is newer`}
        </span>
      </span>
      <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-link">
        In canvas
        <ArrowUpRight className="size-3.5" aria-hidden />
      </span>
    </a>
  )
}

export default function ArtifactCards({ sessionId, messageId, viewport }: TurnRegionProps): JSX.Element | null {
  const snap = useArtifacts(sessionId)
  const shown = snap.mentions[messageId]
  const ref = useRef<HTMLDivElement>(null)
  useMarkInCanvas(ref, shown, snap.running)
  if (!shown?.length) return null
  const store = artifactsStore()
  return (
    <div ref={ref} className="my-1 flex flex-col gap-2" data-artifact-cards>
      {shown.map((a) => {
        const latest = snap.latest.find((l) => l.key === a.key)
        // An older reply's card opens the version it made; the latest one is not pinned.
        const pin = latest && latest.version !== a.version ? a.version : undefined
        return (
          <ArtifactCard
            key={a.key}
            artifact={a}
            latest={latest}
            touch={viewport === 'phone'}
            onOpen={() => {
              if (sessionId) store.open(sessionId, a.key, pin)
              else store.select(null, a.key, pin)
            }}
          />
        )
      })}
    </div>
  )
}
