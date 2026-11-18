// Docs media (DocsMedia.tsx, embeds.ts) through the docs Markdown pipeline, sanitizer included.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { DOCS_TAG_COMPONENTS } from './DocsBlocks'
import { DocsImage, DocsSource } from './DocsMedia'
import { embedTarget } from './embeds'
import { Markdown } from '../markdown/Markdown'
import { preprocessMkdocsMarkdown } from '../markdown/mkdocsPreprocess'
import { DOCS_ALLOWED_ELEMENTS } from '../markdown/docsTags'

const COMPONENTS = { ...DOCS_TAG_COMPONENTS, img: DocsImage, source: DocsSource }
const render = (md: string) => renderToStaticMarkup(
    <Markdown variant="docs" components={COMPONENTS} allowElements={DOCS_ALLOWED_ELEMENTS}>{preprocessMkdocsMarkdown(md)}</Markdown>,
)

test('YouTube, Vimeo and Loom URLs in any form play from their privacy-friendly player; others are not embeds', () => {
    const yt = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1'
    for (const u of ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://m.youtube.com/shorts/dQw4w9WgXcQ']) {
        assert.equal(embedTarget(u)?.play, yt, u)
    }
    assert.equal(embedTarget('https://youtu.be/dQw4w9WgXcQ?t=42')?.play, `${yt}&start=42`)
    assert.equal(embedTarget('https://vimeo.com/76979871')?.play, 'https://player.vimeo.com/video/76979871?autoplay=1&dnt=1')
    assert.equal(embedTarget('https://player.vimeo.com/video/76979871?h=abc123')?.play, 'https://player.vimeo.com/video/76979871?autoplay=1&dnt=1&h=abc123')
    assert.equal(embedTarget('https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184')?.provider, 'Loom')
    for (const bad of ['https://evil.example/embed/x', 'https://youtube.com.evil.example/embed/dQw4w9WgXcQ', 'javascript:alert(1)', '/local.html', undefined]) {
        assert.equal(embedTarget(bad), null, String(bad))
    }
})

test('an <iframe> video is a play button until pressed: no iframe and no provider URL on the page', () => {
    const html = render('<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="Tour" allowfullscreen></iframe>')
    assert.match(html, /<div class="aiui-embed" style="aspect-ratio:560 \/ 315;max-width:560px"><button type="button" class="aiui-embed-poster" aria-label="Play: Tour">/)
    assert.ok(!/<iframe|youtube/.test(html), html)
})

test('an iframe from any other site is a link; a javascript: one is dropped; code keeps it as text', () => {
    assert.match(render('<iframe src="https://other.example/w" title="Widget"></iframe>'), /<a href="https:\/\/other.example\/w" target="_blank" rel="noopener noreferrer">Widget<\/a>/)
    assert.ok(!/javascript|<a /.test(render('<iframe src="javascript:alert(1)"></iframe>')))
    assert.match(render('Write `<iframe src="x">`.\n\n```html\n<video src="a.mp4"></video>\n```'), /&lt;iframe src=&quot;x&quot;&gt;[\s\S]*&lt;video/)
    assert.match(render('<div>kept</div>'), /kept/)
})

test('<video autoPlay muted loop playsInline> and <source> children render as a video', () => {
    const html = render('<video autoPlay muted loop playsInline src="https://cdn.example/a.mp4"></video>')
    assert.match(html, /<video class="aiui-video" src="https:\/\/cdn.example\/a.mp4"[^>]* autoplay="" muted="" loop="" playsinline="" preload="auto">/i)
    assert.ok(!/controls/.test(html), html)
    const withSource = render('<video controls>\n  <source src="https://cdn.example/a.webm" type="video/webm" />\n</video>')
    assert.match(withSource, /<video class="aiui-video"[^>]* controls=""[^>]*preload="metadata">[\s\S]*<source src="https:\/\/cdn.example\/a.webm" type="video\/webm"\/>/)
})

test('images: noZoom, dark:hidden / dark:block classes and GitHub #gh-*-mode-only suffixes; other classes go', () => {
    assert.match(render('<img src="/a.png" alt="A" noZoom />'), /<img[^>]* data-nozoom=""/)
    assert.match(render('<img className="block dark:hidden" src="/l.png" alt="L" />'), /<img[^>]* data-theme-only="light"/)
    assert.match(render('<img className="hidden dark:block" src="/d.png" alt="D" />'), /<img[^>]* data-theme-only="dark"/)
    assert.match(render('![D](/d.png#gh-dark-mode-only)'), /<img[^>]* data-theme-only="dark"/)
    const plain = render('<img className="fixed inset-0" src="/a.png" alt="A" width="200" />')
    assert.ok(!/fixed|data-theme-only|data-nozoom/.test(plain), plain)
    assert.match(plain, /width="200"/)
})

test('<picture> sources for a colour scheme follow the site theme (light when rendered without one)', () => {
    const html = render('<picture>\n  <source media="(prefers-color-scheme: dark)" srcset="/d.png" />\n  <img src="/l.png" alt="P" />\n</picture>')
    assert.match(html, /<source srcSet="\/d.png" media="not all"\/>/)
})
