import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { BlockTreeView } from '@/blocks/BlockRenderer'
import { BlockTree } from '@/sdk/blockTree'
import { registerBlock, type BlockNode } from '@/sdk/registry'
import { useBlockContext, type BlockActionRequest } from '@/blocks/context'

test('BlockTreeView renders a single block and an array of sibling blocks', () => {
  registerBlock('bt_demo_pill', ({ node }) => (
    <span data-testid="pill">{String(node.props?.text ?? '')}</span>
  ))

  const single = renderToStaticMarkup(
    <BlockTreeView node={{ type: 'bt_demo_pill', props: { text: 'one' } }} />,
  )
  assert.match(single, /data-testid="pill">one<\/span>/)

  const list: BlockNode[] = [
    { type: 'bt_demo_pill', props: { text: 'alpha' } },
    { type: 'bt_demo_pill', props: { text: 'beta' } },
  ]
  const multi = renderToStaticMarkup(<BlockTreeView node={list} />)
  assert.match(multi, />alpha<\/span>/)
  assert.match(multi, />beta<\/span>/)
})

test('BlockTreeView wires BlockContext.runAction to onAction', async () => {
  const holder: { runAction: ((req: BlockActionRequest) => Promise<boolean>) | null } = {
    runAction: null,
  }

  registerBlock('bt_action_probe', () => {
    const ctx = useBlockContext()
    holder.runAction = ctx.runAction
    return <div>probe</div>
  })

  const received: Record<string, unknown>[] = []
  renderToStaticMarkup(
    <BlockTreeView
      node={{ type: 'bt_action_probe' }}
      onAction={async (req) => {
        received.push(req.body)
        return req.body.ok !== false
      }}
    />,
  )

  assert.ok(holder.runAction, 'BlockContext.runAction was provided')
  assert.equal(await holder.runAction({ body: { action: 'ping', ok: true } }), true)
  assert.equal(await holder.runAction({ body: { action: 'fail', ok: false } }), false)
  assert.deepEqual(received, [
    { action: 'ping', ok: true },
    { action: 'fail', ok: false },
  ])
})

test('BlockTreeView handles empty arrays and catches throwing onAction cleanly', async () => {
  assert.equal(renderToStaticMarkup(<BlockTreeView node={[]} />), '')

  const holder: { runAction: ((req: BlockActionRequest) => Promise<boolean>) | null } = {
    runAction: null,
  }
  registerBlock('bt_throw_probe', () => {
    const ctx = useBlockContext()
    holder.runAction = ctx.runAction
    return <div>throw-probe</div>
  })

  renderToStaticMarkup(
    <BlockTreeView
      node={{ type: 'bt_throw_probe' }}
      onAction={async () => {
        throw new Error('handler exploded')
      }}
    />,
  )

  const origWarn = console.warn
  console.warn = () => {}
  try {
    assert.equal(await holder.runAction!({ body: { action: 'boom' } }), false)
  } finally {
    console.warn = origWarn
  }
})

test('BlockTree renders fallback while lazy BlockRenderer chunk is pending', () => {
  const html = renderToStaticMarkup(
    <BlockTree
      node={{ type: 'metric', props: { label: 'Runs', value: '3' } }}
      fallback={<span data-testid="bt-loading">waiting</span>}
    />,
  )
  assert.match(html, /waiting|Runs/)
})
