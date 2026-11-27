/**
 * BlockPage / YAML / Docs <ComponentPreview> adapter for `sheet` and `whiteboard` blocks.
 * Reuses the exact same SheetViewer and WhiteboardViewer components used by chat fences
 * and the Artifacts Canvas panel (100% DRY).
 */
import type { JSX } from 'react'
import { useBlockContext } from '@/blocks/context'
import type { BlockNode } from '@/sdk/registry'
import SheetViewer, { type SheetSavePayload } from './SheetGrid'
import WhiteboardViewer from './Whiteboard'

export default function StudioBlock({ node }: { node: BlockNode }): JSX.Element {
  const ctx = useBlockContext()
  const props = node.props ?? {}
  const content = typeof props.content === 'string' ? props.content : JSON.stringify(props)
  if (node.type === 'sheet') {
    const action = typeof props.action === 'string' && props.action.trim() ? props.action.trim() : undefined
    const saveLabel = typeof props.save_label === 'string' && props.save_label.trim() ? props.save_label.trim() : 'Save'
    const onSave = action
      ? async (payload: SheetSavePayload) =>
          ctx.runAction({
            body: { action, ...payload },
            label: saveLabel,
          })
      : undefined
    return <SheetViewer content={content} onSave={onSave} saveLabel={saveLabel} />
  }
  if (node.type === 'whiteboard') return <WhiteboardViewer content={content} />
  return <></>
}
