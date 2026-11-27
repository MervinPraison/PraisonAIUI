/**
 * Inline UI block renderer for chat messages (lazy chunk).
 *
 * Renders `type: 'block'` (from `await aiui.send_block(...)`), `type: 'dataframe'`
 * (from `aiui.Dataframe(df)`), `type: 'plotly'` (from `aiui.Plotly(fig)`), and
 * raw `aiui.*` component dicts passed via `Message(elements=[...])` using the
 * shared `BlockList` renderer. Loaded only when a message actually carries a
 * structured block element, keeping `/chat` first-paint budgets untouched (R10).
 */
import { useMemo, type FC } from 'react'
import { BlockList } from '@/blocks/BlockRenderer'
import { BlockContext, type BlockActionRequest, type BlockContextValue } from '@/blocks/context'
import { str } from '@/blocks/normalize'
import { notify } from '@/sdk/notify'
import { elementToBlockNodes } from './blockElementModel'

const BlockElement: FC<{ data: Record<string, unknown> }> = ({ data }) => {
  const nodes = useMemo(() => elementToBlockNodes(data), [data])
  const ctx = useMemo<BlockContextValue>(
    () => ({
      async runAction(req: BlockActionRequest) {
        const actionName = str(req.body.action)
        if (!actionName) {
          void notify(req.label ? `${req.label} triggered` : 'Action triggered', { type: 'info' })
          return true
        }
        try {
          const res = await fetch(`/api/actions/${encodeURIComponent(actionName)}/click`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ name: actionName, payload: req.body }),
          })
          if (!res.ok) {
            void notify(req.label ? `${req.label} failed` : 'Action failed', { type: 'error' })
            return false
          }
          void notify(req.label ? `${req.label}: done` : 'Done', { type: 'success' })
          return true
        } catch {
          void notify(req.label ? `${req.label} failed` : 'Action failed', { type: 'error' })
          return false
        }
      },
    }),
    [],
  )

  if (!nodes.length) return null
  return (
    <div className="my-2 min-w-0 max-w-full" data-element={typeof data.type === 'string' ? data.type : 'block'}>
      <BlockContext.Provider value={ctx}>
        <div className="flex min-w-0 flex-col gap-3">
          <BlockList nodes={nodes} />
        </div>
      </BlockContext.Provider>
    </div>
  )
}

export default BlockElement
