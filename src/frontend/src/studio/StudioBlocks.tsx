/**
 * BlockPage / YAML / Docs <ComponentPreview> adapter for `sheet` and `whiteboard` blocks.
 * Reuses the exact same SheetViewer and WhiteboardViewer components used by chat fences
 * and the Artifacts Canvas panel (100% DRY).
 */
import type { JSX } from 'react'
import type { BlockNode } from '@/sdk/registry'
import SheetViewer from './SheetGrid'
import WhiteboardViewer from './Whiteboard'

export default function StudioBlock({ node }: { node: BlockNode }): JSX.Element {
  const props = node.props ?? {}
  const content = typeof props.content === 'string' ? props.content : JSON.stringify(props)
  if (node.type === 'sheet') return <SheetViewer content={content} />
  if (node.type === 'whiteboard') return <WhiteboardViewer content={content} />
  return <></>
}
