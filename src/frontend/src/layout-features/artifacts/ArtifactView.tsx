/**
 * One artifact, as the canvas and the artifacts page show it: title and
 * meta, the version menu, Copy / Download / Share (and Run for code the
 * server can run, ⌘↵), the viewer, and History with Restore.
 */
import { type JSX, type KeyboardEvent, type ReactNode } from 'react'
import { Download, Play, Share } from 'lucide-react'
import { CopyGlyph } from './viewers/glyphs'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import type { DerivedArtifact } from './derive'
import { canDownload, clockTime, copyText, kindLine } from './format'
import { canShare, copyArtifact, downloadArtifact, shareArtifact, useCanRun, useRun } from './hooks'
import { HistoryList, VersionMenu } from './Versions'
import { Viewer } from './viewers/Viewer'

export interface ArtifactViewProps {
  artifact: DerivedArtifact
  /** Every version of its key, oldest first. */
  versions: readonly DerivedArtifact[]
  onShow(version: number): void
  onRestore(version: number): void
  /** Phone: History goes under the viewer. */
  compact?: boolean
  /** The reply is still streaming. */
  streaming?: boolean
  /** Extra header buttons (the canvas's split toggle). */
  actions?: ReactNode
  /** The heading id, for the tab panel's aria-labelledby. */
  headingId?: string
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

function provenance(a: DerivedArtifact): string {
  const at = clockTime(a.updatedAt)
  if (a.edited) return at ? `restored by you at ${at}` : 'restored by you'
  return at ? `from the reply at ${at}` : 'from the reply'
}

export function ArtifactView({ artifact: a, versions, onShow, onRestore, compact, streaming, actions, headingId }: ArtifactViewProps): JSX.Element {
  const canRun = useCanRun(a.kind === 'code' ? a.language : undefined)
  const run = useRun(canRun ? a : null)
  const isFile = a.kind === 'code' && a.key === a.title
  const onKeyDown = (e: KeyboardEvent) => {
    if (canRun && e.key === 'Enter' && (isMac() ? e.metaKey : e.ctrlKey)) {
      e.preventDefault()
      run.run()
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-3.5 px-5 py-4" onKeyDown={onKeyDown} data-artifact={a.key} data-version={a.version}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <h2 id={headingId} className={cn('m-0 truncate text-2xl leading-tight font-medium tracking-tight', isFile && 'font-mono text-xl')}>
            {a.title}
          </h2>
          <div className="mt-0.5 text-xs text-tier-3">
            {kindLine(a)} · {provenance(a)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {versions.length > 1 && <VersionMenu versions={versions} shown={a} onShow={onShow} />}
          {/* An unsafe media URL (javascript:, data:text/html) has nothing to copy or save. */}
          {copyText(a) !== '' && (
            <Button variant="ghost" onClick={() => void copyArtifact(a)}>
              <CopyGlyph />
              Copy
            </Button>
          )}
          {canDownload(a) && (
            <Button variant="ghost" onClick={() => downloadArtifact(a)}>
              <Download />
              Download
            </Button>
          )}
          {canShare() && (
            <Button variant="ghost" onClick={() => void shareArtifact(a)}>
              <Share />
              Share
            </Button>
          )}
          {canRun && (
            <Button variant="secondary" onClick={run.run} disabled={run.running} className="bg-accent-soft text-link" aria-keyshortcuts={isMac() ? 'Meta+Enter' : 'Control+Enter'}>
              <Play className="fill-current" />
              {run.running ? 'Running' : 'Run'}
              <Kbd className="hidden sm:inline-flex">{isMac() ? '⌘↵' : 'Ctrl ↵'}</Kbd>
            </Button>
          )}
          {actions}
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-0 flex-1 basis-90">
          <Viewer artifact={a} run={canRun ? run : undefined} streaming={streaming} />
        </div>
        {versions.length > 1 && (
          <HistoryList
            versions={versions}
            shown={a}
            onShow={onShow}
            onRestore={onRestore}
            className={compact ? 'w-full border-t border-hairline pt-3' : 'min-w-45 shrink basis-52'}
          />
        )}
      </div>
    </div>
  )
}
