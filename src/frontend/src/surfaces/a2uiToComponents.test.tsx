// A2UI in chat without @a2ui/react: the component fallback renders Markdown
// as markdown (never a JSON dump) and gates agent-chosen images.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { prerenderToNodeStream } from 'react-dom/static'
import { ComponentRenderer } from '@/components/ComponentRenderer'
import { Markdown } from '@/markdown/Markdown'
import { a2uiToComponents } from '@/surfaces/a2uiToComponents'
import { SurfaceHost } from '@/surfaces/SurfaceHost'

const update = (...components: Record<string, unknown>[]) => [{ updateComponents: { surfaceId: 's1', components } }]

async function prerender(node: React.ReactNode): Promise<string> {
  const { prelude } = await prerenderToNodeStream(<>{node}</>, { onError: () => {} })
  let html = ''
  for await (const chunk of prelude) html += String(chunk)
  return html
}

test('A2UI Text + Markdown render as content, not as a JSON dump', async () => {
  const messages = update(
    { id: 't', component: 'Text', text: { literal: 'Hello' } },
    { id: 'm', component: 'Markdown', text: { literal: '**Bold** and a [link](https://x.y)' } },
  )
  const first = renderToStaticMarkup(<SurfaceHost mode="auto" messages={messages} />)
  assert.doesNotMatch(first, /"type":\s*"markdown"/, first)
  assert.doesNotMatch(first, /<pre/, first)
  assert.match(first, /<p>Hello<\/p>/)
  // Once the markdown chunk has loaded: real markdown.
  const html = await prerender(<SurfaceHost mode="auto" messages={messages} />)
  assert.match(html, /data-streamdown="strong">Bold</, html)
  assert.match(html, /<a[^>]*href="https:\/\/x\.y\/?"/, html)
})

test('ui.markdown_text is parsed as markdown and sanitized, never injected as HTML', async () => {
  const html = await prerender(
    <ComponentRenderer
      components={[{ type: 'markdown_text', content: '# Title\n\n<img src=x onerror="alert(1)"> *em*' }]}
    />,
  )
  assert.match(html, /<h1[^>]*>Title<\/h1>/, html)
  assert.match(html, /<em[^>]*>em<\/em>/, html)
  assert.doesNotMatch(html, /onerror/, html)
})

test('A2UI Image goes through the chat image gate; Button leaves the surface to the A2UI renderer', () => {
  const mapped = a2uiToComponents(update({ id: 'i', component: 'Image', url: { literal: 'https://evil.example/a.png?d=SECRET' }, text: 'a [b]' }))
  assert.deepEqual(mapped, [{ type: 'markdown', content: '![a \\[b\\]](<https://evil.example/a.png?d=SECRET>)' }])
  const html = renderToStaticMarkup(<Markdown variant="chat">{String(mapped![0].content)}</Markdown>)
  assert.doesNotMatch(html, /<img[^>]*evil\.example/, html)
  assert.match(html, /evil\.example/, 'the placeholder names the host')
  const local = a2uiToComponents(update({ id: 'i', component: 'Image', url: '/api/files/x y.png' }))
  assert.match(renderToStaticMarkup(<Markdown variant="chat">{String(local![0].content)}</Markdown>), /<img[^>]*src="\/api\/files\/x%20y\.png"/)

  assert.equal(a2uiToComponents(update({ id: 'b', component: 'Button', text: 'Go' })), null)
  assert.equal(a2uiToComponents(update({ id: 'i', component: 'Image' })), null, 'no URL: not mapped')
})
