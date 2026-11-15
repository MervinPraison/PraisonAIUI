/**
 * The canvas (a layout's chat `aside` region, ChatRegionProps): the open
 * chat's artifacts as tabs, the selected one in full with its versions,
 * and an optional split pane below for a second artifact (the design's
 * table above, code below). Empty until the chat makes an artifact. Reports
 * the artifact count as the phone tab's badge. Works from the chat alone;
 * the server index is a bonus (./store).
 *
 *   aside: () => import('@/layout-features/artifacts/CanvasPanel')
 */
import { useEffect, useState, type JSX } from 'react'
import { Columns2, Download, Layers, Maximize2, Minimize2, Play, Rows2 } from 'lucide-react'
import { CloseGlyph, CopyGlyph } from './viewers/glyphs'
import type { ChatRegionProps } from '@/sdk/layouts'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DerivedArtifact } from './derive'
import { canDownload, cardMeta, copyText, PANEL_ID as panelId, tabId } from './format'
import { artifactsStore } from './feed'
import { copyArtifact, downloadArtifact, useArtifacts, useCanRun, useRun } from './hooks'
import { ArtifactView } from './ArtifactView'
import { Tabs } from './Tabs'
import { KindIcon, Viewer } from './viewers/Viewer'
import './artifacts.css'

function SplitPane({ artifact: a, onClose }: { artifact: DerivedArtifact; onClose(): void }): JSX.Element {
  const canRun = useCanRun(a.kind === 'code' ? a.language : undefined)
  const run = useRun(canRun ? a : null)
  const file = a.kind === 'code' && a.key === a.title
  return (
    <section aria-label={`${a.title} (split view)`} className="flex min-h-0 flex-col border-t border-hairline" data-artifact-split={a.key}>
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-sidebar py-2 pr-3 pl-4">
        <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-sm font-medium', file && 'font-mono')}>
          <KindIcon kind={a.kind} className="size-3.5 text-link" />
          <span className="truncate">{a.title}</span>
        </span>
        <span className="text-xs text-tier-3">{cardMeta(a, { compact: true })}</span>
        <div className="ml-auto flex items-center gap-0.5">
          {copyText(a) !== '' && (
            <Button variant="ghost" size="icon-sm" aria-label="Copy" onClick={() => void copyArtifact(a)}>
              <CopyGlyph />
            </Button>
          )}
          {canDownload(a) && (
            <Button variant="ghost" size="icon-sm" aria-label={`Download ${a.title}`} onClick={() => downloadArtifact(a)}>
              <Download />
            </Button>
          )}
          {canRun && (
            <Button variant="secondary" size="sm" className="ml-1 bg-accent-soft text-link" onClick={run.run} disabled={run.running}>
              <Play className="fill-current" />
              {run.running ? 'Running' : 'Run'}
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" aria-label="Close the split view" onClick={onClose}>
            <CloseGlyph />
          </Button>
        </div>
      </div>
      <div className="min-h-0 overflow-auto">
        {a.kind === 'code' ? (
          <Viewer artifact={a} run={canRun ? run : undefined} />
        ) : (
          <div className="px-4 py-3">
            <Viewer artifact={a} />
          </div>
        )}
      </div>
    </section>
  )
}

function Empty(): JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-12 text-center" data-canvas-empty>
      <span className="grid size-10 place-items-center rounded-xl bg-muted text-tier-2">
        <Layers className="size-5" aria-hidden />
      </span>
      <p className="m-0 text-base font-semibold">Nothing in the canvas yet</p>
      <p className="m-0 max-w-xs text-sm text-tier-3">Tables, code and files the agent makes in this chat open here, with every version.</p>
    </div>
  )
}

export default function CanvasPanel({ sessionId, viewport, reportBadge }: ChatRegionProps): JSX.Element {
  const snap = useArtifacts(sessionId)
  const store = artifactsStore()
  const [expanded, setExpanded] = useState(false)
  const count = snap.latest.length
  useEffect(() => reportBadge(count), [count, reportBadge])
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setExpanded(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  const phone = viewport === 'phone'
  const sel = snap.selected
  const versions = sel ? snap.versions.filter((v) => v.key === sel.key) : []
  const splitKey = phone ? null : (snap.split?.key ?? null)
  const canSplit = !phone && !!sel && count > 1

  return (
    <section
      aria-label="Canvas"
      data-aiui-canvas
      data-expanded={expanded || undefined}
      data-touch={phone || undefined}
      className={cn('flex min-h-0 flex-1 flex-col overflow-hidden bg-card', !phone && 'm-3 rounded-xl border border-hairline shadow-sm', expanded && 'm-0')}
    >
      {count === 0 ? (
        <Empty />
      ) : (
        <>
          <Tabs items={snap.latest} selected={sel?.key ?? null} split={splitKey} onSelect={(k) => {
              // Choosing the split artifact swaps the two panes.
              if (k === splitKey && sel) store.setSplit(sessionId, sel.key)
              store.select(sessionId, k)
            }}>
            {canSplit && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-pressed={!!splitKey}
                aria-label={splitKey ? 'Close the split view' : 'Split: show another artifact below'}
                title={splitKey ? 'Close the split view' : 'Split view'}
                onClick={() => {
                  if (splitKey) store.setSplit(sessionId, null)
                  else store.setSplit(sessionId, snap.latest.find((a) => a.key !== sel?.key)?.key ?? null)
                }}
              >
                {splitKey ? <Columns2 /> : <Rows2 />}
              </Button>
            )}
            {!phone && (
              <Button variant="ghost" size="icon-sm" aria-pressed={expanded} aria-label={expanded ? 'Restore the canvas' : 'Expand the canvas'} onClick={() => setExpanded((x) => !x)}>
                {expanded ? <Minimize2 /> : <Maximize2 />}
              </Button>
            )}
          </Tabs>
          <div className="flex min-h-0 flex-1 flex-col">
            {sel && (
              <div role="tabpanel" id={panelId} aria-labelledby={tabId(sel.key)} tabIndex={-1} className="min-h-0 flex-1 overflow-auto outline-none">
                <ArtifactView
                  artifact={sel}
                  versions={versions}
                  compact={phone}
                  streaming={snap.running}
                  onShow={(v) => store.select(sessionId, sel.key, v)}
                  onRestore={(v) => store.restore(sessionId, sel.key, v)}
                />
              </div>
            )}
            {snap.split && splitKey && <SplitPane artifact={snap.split} onClose={() => store.setSplit(sessionId, null)} />}
          </div>
        </>
      )}
    </section>
  )
}
