/**
 * Dedicated Excalidraw canvas. Not the sticky whiteboard.
 * Kept outside layout-features so the diagram chunk is not part of the
 * artifacts feature budget. The chat loads it only after an ```excalidraw fence.
 */
import { useMemo } from 'react'
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

type Skeleton = { type?: string; version?: number; id?: string }

function sceneElements(content: string): readonly object[] {
  const doc = JSON.parse(content) as { elements?: Skeleton[] } | Skeleton[]
  const raw = Array.isArray(doc) ? doc : Array.isArray(doc.elements) ? doc.elements : []
  const complete = raw.length > 0 && raw.every((el) => el && typeof el.version === 'number' && typeof el.id === 'string')
  if (complete) return raw
  return convertToExcalidrawElements(raw as never, { regenerateIds: true })
}

export default function ExcalidrawBoard({ content }: { content: string }) {
  const parsed = useMemo(() => {
    try {
      return { elements: sceneElements(content), error: '' }
    } catch {
      return { elements: [], error: 'This diagram is not a valid Excalidraw scene.' }
    }
  }, [content])
  if (parsed.error) return <p className="p-4 text-sm text-tier-3">{parsed.error}</p>
  return (
    <div data-excalidraw="" className="h-[420px] overflow-hidden rounded-lg border border-hairline">
      <Excalidraw
        initialData={{ elements: parsed.elements as never }}
        UIOptions={{ canvasActions: { export: false, loadScene: false, saveToActiveFile: false } }}
      />
    </div>
  )
}
