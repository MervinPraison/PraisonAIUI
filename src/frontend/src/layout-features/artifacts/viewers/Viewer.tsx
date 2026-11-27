/** The viewer for an artifact's kind. */
import { lazy, Suspense, type JSX } from 'react'
import { FileCode, FileImage, FileText, FileVideo, LayoutTemplate, Sheet, type LucideProps } from 'lucide-react'
import type { ArtifactKind } from '@/sdk/layoutTypes'
import type { DerivedArtifact } from '../derive'
import type { RunState } from '../hooks'
import A2uiViewer from './A2ui'
import CodeViewer from './Code'
import FileViewer from './File'
import ImageViewer from './Image'
import MarkdownViewer from './Markdown'
import TableViewer from './Table'

const LazySheetViewer = lazy(() => import('@/studio/SheetGrid'))
const LazyWhiteboardViewer = lazy(() => import('@/studio/Whiteboard'))

const ICONS: Record<ArtifactKind, (p: LucideProps) => JSX.Element> = {
  table: (p) => <Sheet {...p} />,
  code: (p) => <FileCode {...p} />,
  markdown: (p) => <FileText {...p} />,
  file: (p) => <FileText {...p} />,
  pdf: (p) => <FileText {...p} />,
  image: (p) => <FileImage {...p} />,
  video: (p) => <FileVideo {...p} />,
  a2ui: (p) => <LayoutTemplate {...p} />,
  whiteboard: (p) => <LayoutTemplate {...p} />,
  sheet: (p) => <Sheet {...p} />,
}

export function KindIcon({ kind, ...p }: { kind: ArtifactKind } & LucideProps): JSX.Element {
  const I = ICONS[kind] ?? ICONS.file
  return <I aria-hidden {...p} />
}

export function Viewer({ artifact: a, run, streaming }: { artifact: DerivedArtifact; run?: RunState; streaming?: boolean }): JSX.Element {
  switch (a.kind) {
    case 'table':
      return <TableViewer content={a.content ?? ''} label={a.title} />
    case 'code':
      return <CodeViewer code={a.content ?? ''} language={a.language ?? ''} run={run} className="overflow-hidden rounded-lg border border-hairline" />
    case 'markdown':
      return <MarkdownViewer content={a.content ?? ''} streaming={streaming} />
    case 'image':
      return <ImageViewer url={a.url ?? ''} alt={a.title} />
    case 'a2ui':
      return <A2uiViewer content={a.content ?? '[]'} surfaceId={a.key.replace(/^a2ui:/, '')} sessionId={a.sessionId ?? undefined} />
    case 'sheet':
      return (
        <Suspense fallback={<div className="p-4 text-xs text-tier-3">Loading spreadsheet…</div>}>
          <LazySheetViewer content={a.content ?? '{}'} streaming={streaming} />
        </Suspense>
      )
    case 'whiteboard':
      return (
        <Suspense fallback={<div className="p-4 text-xs text-tier-3">Loading whiteboard…</div>}>
          <LazyWhiteboardViewer content={a.content ?? '{}'} streaming={streaming} />
        </Suspense>
      )
    default:
      return <FileViewer kind={a.kind} url={a.url ?? ''} name={a.title} mime={a.mimeType} />
  }
}
