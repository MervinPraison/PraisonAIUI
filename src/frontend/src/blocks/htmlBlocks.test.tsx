// The html block's sandboxed frame (blocks/htmlFrame.ts, HtmlBlock.tsx), metric
// captions and Markdown in callouts (coreBlocks.tsx).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server'
import { getCoreBlock } from '@/blocks/coreBlocks'
import { buildSrcdoc, DEFAULT_CSP, fixedHeight, frameHeight, MAX_FRAME_HEIGHT, MSG_HEIGHT } from '@/blocks/htmlFrame'
import { hardBreaks } from '@/blocks/normalize'
import type { BlockNode } from '@/sdk/registry'

const render = (node: BlockNode) => {
  const C = getCoreBlock(node.type)
  assert.ok(C, `no core block for ${node.type}`)
  return renderMarkup(<C node={node} />).split('<!-- -->').join('')
}

test('html and html_embed render a sandboxed frame without same-origin', () => {
  for (const type of ['html', 'html_embed']) {
    const out = render({ type, props: { content: '<b>hi</b><script>x()</script>' } })
    assert.match(out, /<iframe /)
    assert.match(out, /sandbox="allow-scripts"/)
    assert.doesNotMatch(out, /allow-same-origin/)
    assert.match(out, /title="Embedded content"/)
    // The app HTML lives only inside srcdoc (escaped as an attribute), never in the page.
    assert.doesNotMatch(out, /<b>hi<\/b>/)
    assert.match(out, /srcDoc="|srcdoc="/i)
  }
})

test('html: a fixed height, a custom title and trusted inline content', () => {
  const fixed = render({ type: 'html', props: { content: 'x', height: 240, title: 'Chart' } })
  assert.match(fixed, /height:240px/)
  assert.match(fixed, /title="Chart"/)
  const inline = render({ type: 'html', props: { content: '<em>ok</em>', trusted: true } })
  assert.doesNotMatch(inline, /<iframe/)
  assert.match(inline, /data-aiui-html="inline"/)
})

test('srcdoc: CSP meta first, theme variables, the sizing script after the content', () => {
  const doc = buildSrcdoc('<p>A</p>', { vars: { '--aiui-fg': 'red', 'color': 'blue' }, scheme: 'dark' })
  const csp = doc.indexOf('http-equiv="Content-Security-Policy"')
  assert.ok(csp > 0 && csp < doc.indexOf('<p>A</p>'))
  assert.ok(doc.includes(`content="${DEFAULT_CSP}"`))
  assert.match(doc, /--aiui-fg:red/)
  assert.doesNotMatch(doc, /color:blue/) // only --aiui-* names pass
  assert.match(doc, /color-scheme:dark/)
  assert.ok(doc.indexOf('<p>A</p>') < doc.lastIndexOf('<script>'))
  // A custom policy replaces the default; quotes cannot break out of the attribute.
  const custom = buildSrcdoc('', { csp: `default-src 'none'" onload="x` })
  assert.match(custom, /default-src 'none'&quot; onload=&quot;x/)
  // A theme value cannot close the style element.
  assert.doesNotMatch(buildSrcdoc('', { vars: { '--aiui-fg': 'red}</style><script>' } }), /red}<\/style>/)
})

test('frameHeight accepts only well-formed height messages and clamps them', () => {
  assert.equal(frameHeight({ type: MSG_HEIGHT, height: 120.2 }), 121)
  assert.equal(frameHeight({ type: MSG_HEIGHT, height: 1e9 }), MAX_FRAME_HEIGHT)
  assert.equal(frameHeight({ type: MSG_HEIGHT, height: -5 }), 0)
  assert.equal(frameHeight({ type: MSG_HEIGHT, height: '9' }), null)
  assert.equal(frameHeight({ type: 'other', height: 9 }), null)
  assert.equal(frameHeight(null), null)
})

test('fixedHeight: numbers are pixels, CSS lengths pass, anything else is ignored', () => {
  assert.equal(fixedHeight(300), '300px')
  assert.equal(fixedHeight('20rem'), '20rem')
  assert.equal(fixedHeight('300'), '300px')
  assert.equal(fixedHeight('1px;background:red'), undefined)
  assert.equal(fixedHeight(0), undefined)
})

test('metric: caption shows under the value, uncoloured and separate from delta', () => {
  const out = render({ type: 'metric', props: { label: 'Posts', value: 51, delta: '-3 days', delta_color: 'inverse', caption: 'last 30 days' } })
  assert.match(out, /data-slot="metric-caption"[^>]*>last 30 days</)
  assert.match(out, /text-success[^"]*">-3 days</) // inverse: a fall is good
  const off = render({ type: 'metric', props: { label: 'L', value: 1, delta: '-2', delta_color: 'off', caption: 'median' } })
  assert.match(off, /text-muted-foreground[^"]*">-2</)
  assert.match(off, />median</)
  assert.doesNotMatch(render({ type: 'metric', props: { label: 'L', value: 1 } }), /metric-caption/)
})

test('callout and alert bodies go through the Markdown renderer, text escaped', () => {
  for (const type of ['callout', 'alert']) {
    const out = render({ type, props: { content: '**a**\n<img src=x onerror=alert(1)>', message: '**a**\n<img src=x onerror=alert(1)>' } })
    assert.match(out, /aiui-markdown/)
    assert.doesNotMatch(out, /<img src=x/)
  }
})

test('hardBreaks: single newlines break, paragraphs and fenced code stay as written', () => {
  assert.equal(hardBreaks('a\nb'), 'a  \nb')
  assert.equal(hardBreaks('a\n\nb'), 'a\n\nb')
  assert.equal(hardBreaks('```\nx\ny\n```\nz'), '```\nx\ny\n```\nz')
  assert.equal(hardBreaks('- one\n- two'), '- one  \n- two')
})
