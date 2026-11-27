// Tests for lazy rich UI blocks (blocks/RichBlocks.tsx & blocks/diffModel.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { CORE_BLOCK_TYPES, getCoreBlock } from './coreBlocks'
import { computeLineDiff, MAX_DIFF_LINES } from './diffModel'
import {
  CopyFieldBlock,
  DiffViewerBlock,
  RatingInputBlock,
  StepperBlock,
  TimelineBlock,
  TreeViewBlock,
} from './RichBlocks'

test('all 6 rich blocks are registered lazily in CORE_BLOCK_TYPES', () => {
  for (const type of ['stepper', 'timeline', 'diff_viewer', 'tree_view', 'copy_field', 'rating_input']) {
    assert.ok(CORE_BLOCK_TYPES.includes(type), `${type} in CORE_BLOCK_TYPES`)
    assert.ok(getCoreBlock(type), `${type} registered`)
  }
})

test('computeLineDiff computes unchanged, removed, and added lines accurately', () => {
  const res = computeLineDiff('line1\nold\nline3', 'line1\nnew\nline3\nextra')
  assert.equal(res.added, 2)
  assert.equal(res.removed, 1)
  assert.equal(res.truncated, false)
  assert.deepEqual(
    res.lines.map((l) => [l.kind, l.text]),
    [
      ['same', 'line1'],
      ['del', 'old'],
      ['add', 'new'],
      ['same', 'line3'],
      ['add', 'extra'],
    ],
  )
})

test('computeLineDiff caps oversized inputs at MAX_DIFF_LINES', () => {
  const big = Array.from({ length: MAX_DIFF_LINES + 50 }, (_, i) => `row-${i}`).join('\n')
  const res = computeLineDiff(big, big)
  assert.equal(res.truncated, true)
  assert.equal(res.lines.length, MAX_DIFF_LINES)
})

test('StepperBlock marks done, active (aria-current="step"), and pending steps', () => {
  const html = renderToStaticMarkup(
    <StepperBlock
      node={{
        type: 'stepper',
        props: {
          active: 1,
          steps: [
            { title: 'Plan' },
            { title: 'Build', description: 'Compiling assets' },
            { title: 'Ship' },
          ],
        },
      }}
    />,
  )
  assert.match(html, /data-step-state="done"/)
  assert.match(html, /aria-current="step"/)
  assert.match(html, /data-step-state="pending"/)
  assert.match(html, /Compiling assets/)
})

test('TimelineBlock renders titles, timestamps, and badges safely', () => {
  const html = renderToStaticMarkup(
    <TimelineBlock
      node={{
        type: 'timeline',
        props: {
          title: 'Audit',
          items: [{ title: 'Release <v1>', timestamp: '12:00', badge: 'prod', status: 'success' }],
        },
      }}
    />,
  )
  assert.match(html, /Release &lt;v1&gt;/)
  assert.match(html, />prod</)
  assert.match(html, /12:00/)
})

test('DiffViewerBlock renders summary counts and escapes untrusted code lines', () => {
  const html = renderToStaticMarkup(
    <DiffViewerBlock
      node={{
        type: 'diff_viewer',
        props: { title: 'Prompt', before: '<script>x</script>', after: 'safe line' },
      }}
    />,
  )
  assert.match(html, /\+1/)
  assert.match(html, /-1/)
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/)
  assert.doesNotMatch(html, /<script>x<\/script>/)
})

test('TreeViewBlock renders collapsible branches and strips unsafe javascript: links', () => {
  const html = renderToStaticMarkup(
    <TreeViewBlock
      node={{
        type: 'tree_view',
        props: {
          title: 'Files',
          default_expanded: true,
          nodes: [
            {
              label: 'src',
              children: [
                { label: 'safe.ts', href: 'https://example.com/safe.ts', badge: 'TS' },
                { label: 'evil.ts', href: 'javascript:alert(1)' },
              ],
            },
          ],
        },
      }}
    />,
  )
  assert.match(html, /aria-expanded="true"/)
  assert.match(html, /href="https:\/\/example\.com\/safe\.ts"/)
  assert.doesNotMatch(html, /javascript:alert/)
})

test('CopyFieldBlock masks secret values and keeps role="status" outside the copy button', () => {
  const html = renderToStaticMarkup(
    <CopyFieldBlock
      node={{ type: 'copy_field', props: { label: 'API Key', value: 'sk-secret-9999', secret: true } }}
    />,
  )
  assert.doesNotMatch(html, /sk-secret-9999/)
  assert.match(html, /aria-label="Reveal API Key"/)
  assert.match(html, /aria-label="Copy API Key"/)
  assert.match(html, /<\/button><span role="status"/)
})

test('RatingInputBlock renders radiogroup + hidden input when interactive and img when readonly', () => {
  const interactive = renderToStaticMarkup(
    <RatingInputBlock node={{ type: 'rating_input', props: { label: 'Quality', name: 'q', value: 3, max_stars: 5 } }} />,
  )
  assert.match(interactive, /role="radiogroup"/)
  assert.match(interactive, /type="hidden"[^>]*name="q"[^>]*value="3"/)
  assert.match(interactive, /3\/5/)

  const ro = renderToStaticMarkup(
    <RatingInputBlock node={{ type: 'rating_input', props: { label: 'Score', value: 4, max_stars: 5, readonly: true } }} />,
  )
  assert.match(ro, /role="img"/)
  assert.match(ro, /4 out of 5 stars/)
  assert.doesNotMatch(ro, /type="hidden"/)
})
