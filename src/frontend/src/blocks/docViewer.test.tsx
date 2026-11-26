// BlockPage Markdown document viewer & TOC extraction (blocks/DocViewer.tsx).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { DocViewer } from './DocViewer'
import { extractMarkdownHeadings } from './docToc'

test('extractMarkdownHeadings extracts h2/h3, respects custom ids, strips inline formatting and ignores fences', () => {
  const md = [
    '# Title (h1 ignored)',
    '## Getting **started**',
    '```markdown',
    '## Not a heading inside code',
    '```',
    '### Using `aiui.doc_viewer`',
    '## Custom Anchor {#my-anchor}',
    '~~~',
    '### Also ignored',
    '~~~',
    '### Read [the docs](https://example.com)',
  ].join('\n')

  assert.deepEqual(extractMarkdownHeadings(md), [
    { id: 'getting-started', text: 'Getting started', level: 2 },
    { id: 'using-aiuidoc_viewer', text: 'Using aiui.doc_viewer', level: 3 },
    { id: 'my-anchor', text: 'Custom Anchor', level: 2 },
    { id: 'read-the-docs', text: 'Read the docs', level: 3 },
  ])
})

test('DocViewer renders title, sticky desktop TOC and collapsible mobile TOC when toc=true', () => {
  const html = renderToStaticMarkup(
    <DocViewer title="Architecture Guide" toc content={'## Summary\n\nHello\n\n### Details\n\nMore'} />,
  )
  assert.match(html, />Architecture Guide<\/h2>/)
  assert.match(html, /data-doc-toc=""/)
  assert.match(html, /data-doc-toc-mobile=""/)
  assert.match(html, /href="#summary"[^>]*>Summary<\/a>/)
  assert.match(html, /href="#details"[^>]*>Details<\/a>/)
})

test('DocViewer omits TOC when there are no h2/h3 headings', () => {
  const html = renderToStaticMarkup(<DocViewer toc content="Just a paragraph." />)
  assert.doesNotMatch(html, /data-doc-toc=/)
})
