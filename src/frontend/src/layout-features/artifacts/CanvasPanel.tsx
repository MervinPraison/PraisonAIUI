/**
 * The canvas (a layout's chat `aside` region, ChatRegionProps): the open
 * chat's artifacts as tabs (with split, "+" to open another one below,
 * expand and close), the selected one in full with its versions, and a
 * split pane below for a second artifact (the design's table above, code
 * below: code docks there by default, ./store autoSplit). Empty until the chat makes an artifact. Reports
 * the artifact count as the phone tab's badge. Works from the chat alone;
 * the server index is a bonus (./store).
 *
 *   aside: () => import('@/layout-features/artifacts/CanvasPanel')
 */
import { useEffect, useState, type JSX } from 'react'
import { Columns2, Download, Layers, Maximize2, Minimize2, Play, Plus, Rows2 } from 'lucide-react'
import { CloseGlyph, CopyGlyph } from './viewers/glyphs'
import type { ChatRegionProps } from '@/sdk/layouts'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { navigate } from '@/sdk/services'
import { cn } from '@/lib/utils'
import type { DerivedArtifact } from './derive'
import { ARTIFACTS_PAGE, artifactsPageListed } from './api'
import { byLine, canDownload, copyText, kindLine, PANEL_ID as panelId, tabId } from './format'
import { Menu, menuItemClass } from './Menu'
import { ASIDE_EVENT } from './store'
import { artifactsStore } from './feed'
import { copyArtifact, downloadArtifact, useArtifacts, useCanRun, useRun } from './hooks'
import { ArtifactView } from './ArtifactView'
import { Tabs } from './Tabs'
import { KindIcon, Viewer } from './viewers/Viewer'
import './artifacts.css'

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** Ask the chat's aside to close (chat-engine/presentation/Aside ASIDE_EVENT). */
const closeCanvas = () => window.dispatchEvent(new CustomEvent(ASIDE_EVENT, { detail: { open: false } }))

/** The second artifact docked below (Canvas.dc.html: sort_demo.py under the table), with Run ⌘↵ and its output. */
function SplitPane({ artifact: a, onClose }: { artifact: DerivedArtifact; onClose(): void }): JSX.Element {
  const canRun = useCanRun(a.kind === 'code' ? a.language : undefined)
  const run = useRun(canRun ? a : null)
  const file = a.kind === 'code' && a.key === a.title
  return (
    <section
      aria-label={`${a.title} (split view)`}
      className="flex max-h-[48%] min-h-0 shrink-0 flex-col border-t border-hairline"
      data-artifact-split={a.key}
      onKeyDown={(e) => {
        if (canRun && e.key === 'Enter' && (isMac() ? e.metaKey : e.ctrlKey)) {
          e.preventDefault()
          run.run()
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-sidebar py-2 pr-3 pl-4">
        <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-sm font-medium', file && 'font-mono')}>
          <KindIcon kind={a.kind} className="size-3.5 text-link" />
          <span className="truncate">{a.title}</span>
        </span>
        <span className="text-xs text-tier-3">
          {kindLine(a).split(' · ')[0]} · v{a.version} · {byLine(a)}
        </span>
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
            <Button variant="secondary" size="sm" className="ml-1 bg-accent-soft text-link" onClick={run.run} disabled={run.running} aria-keyshortcuts={isMac() ? 'Meta+Enter' : 'Control+Enter'}>
              <Play className="fill-current" />
              {run.running ? 'Running' : 'Run'}
              <Kbd className="hidden sm:inline-flex">{isMac() ? '⌘↵' : 'Ctrl ↵'}</Kbd>
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

/** "+": open another of this chat's artifacts below the shown one, or every artifact (the artifacts page). */
function OpenMenu({ items, onSplit }: { items: readonly DerivedArtifact[]; onSplit(key: string): void }): JSX.Element {
  const all = artifactsPageListed()
  return (
    <Menu
      label="Open an artifact"
      button={(p) => (
        <Button {...p} variant="ghost" size="icon-sm" aria-label="Open another artifact" title="Open another artifact">
          <Plus />
        </Button>
      )}
    >
      {items.map((a) => (
        <li key={a.key}>
          <button type="button" data-menu-item className={menuItemClass} onClick={() => onSplit(a.key)}>
            <KindIcon kind={a.kind} className="size-3.5 text-link" />
            <span className="truncate">{a.title}</span>
            <span className="ml-auto text-xs text-tier-3">below</span>
          </button>
        </li>
      ))}
      {all && (
        <li className={cn(items.length > 0 && 'mt-1 border-t border-hairline pt-1')}>
          <button type="button" data-menu-item className={menuItemClass} onClick={() => navigate(ARTIFACTS_PAGE)}>
            <Layers className="size-3.5 text-tier-2" />
            All artifacts
          </button>
        </li>
      )}
      {!items.length && !all && <li className="px-2 py-1.5 text-sm text-tier-3">Every artifact of this chat is open</li>}
    </Menu>
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
      // The frame draws the card around its aside (chat-canvas: a raised card); the canvas only fills it.
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit] bg-card"
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
            {!phone && <OpenMenu items={snap.latest.filter((a) => a.key !== sel?.key && a.key !== splitKey)} onSplit={(k) => store.setSplit(sessionId, k)} />}
            {!phone && (
              <Button variant="ghost" size="icon-sm" aria-pressed={expanded} aria-label={expanded ? 'Restore the canvas' : 'Expand the canvas'} onClick={() => setExpanded((x) => !x)}>
                {expanded ? <Minimize2 /> : <Maximize2 />}
              </Button>
            )}
            {!phone && (
              <Button variant="ghost" size="icon-sm" aria-label="Close the canvas" title="Close the canvas" onClick={() => {
                  setExpanded(false)
                  closeCanvas()
                }}>
                <CloseGlyph />
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
