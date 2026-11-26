// Media, navigation and overlay blocks (blocks/mediaBlocks.tsx, blocks/mediaModel.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server'
// The core set (and through it mediaBlocks) registers itself, as the blocks chunk does.
import { CORE_BLOCK_TYPES, getCoreBlock } from '@/blocks/coreBlocks'
import { BlockList } from '@/blocks/BlockRenderer'
import { initials, pageHref, resolveAppPageHref } from '@/blocks/mediaModel'
import { toBlockNodes } from '@/blocks/normalize'

const html = (components: unknown[]) => renderMarkup(<BlockList nodes={toBlockNodes(components)} />).split('<!-- -->').join('')

const NATIVE = [
  'avatar',
  'audio_player',
  'video_player',
  'file_download',
  'breadcrumb',
  'tooltip_wrap',
  'popover',
  'dialog',
  'card_grid',
  'link',
  'color_picker_input',
  'pagination',
]

test('the media, navigation and overlay types have native renderers', () => {
  for (const type of NATIVE) assert.ok(CORE_BLOCK_TYPES.includes(type) && typeof getCoreBlock(type) === 'function', type)
})

test('initials and page paths', () => {
  assert.equal(initials('Ada Lovelace'), 'AL')
  assert.equal(initials('  grace  brewster hopper '), 'GB')
  assert.equal(initials(''), '?')
  assert.equal(pageHref('my page'), '/my%20page')
  assert.equal(pageHref('creator', { creator: 'ada', tag: ['a', 'b'], empty: '' }), '/creator?creator=ada&tag=a&tag=b')
})

test('resolveAppPageHref matches registered same-origin pages and ignores external or unknown paths', () => {
  const g = globalThis as { window?: unknown }
  const prev = g.window
  g.window = { location: { origin: 'http://localhost:8000' } }
  const pages = [{ id: 'creator' }, { id: 'sync' }]
  try {
    assert.deepEqual(resolveAppPageHref('/creator?creator=ada&t=1&t=2', pages), {
      pageId: 'creator',
      params: { creator: 'ada', t: ['1', '2'] },
    })
    assert.equal(resolveAppPageHref('/unknown?x=1', pages), null)
    assert.equal(resolveAppPageHref('/creator/sub', pages), null)
    assert.equal(resolveAppPageHref('/creator#sec', pages), null)
    assert.equal(resolveAppPageHref('https://example.com/creator', pages), null)
  } finally {
    g.window = prev
  }
})

test('avatar: an image with the name as its label, initials otherwise', () => {
  const out = html([{ type: 'avatar', name: 'Ada Lovelace', size: 'lg' }, { type: 'avatar', fallback: 'JD' }])
  assert.match(out, /data-size="lg"[^>]*role="img" aria-label="Ada Lovelace"/)
  assert.match(out, />AL<\/span>/)
  assert.match(out, /aria-label="JD"[^>]*>.*>JD<\/span>/)
})

test('audio and video players: controls, a caption, only safe URLs, muted autoplay', () => {
  const out = html([
    { type: 'audio_player', src: '/a.mp3', title: 'Intro' },
    { type: 'video_player', src: '/v.mp4', poster: '/p.png', autoplay: true },
    { type: 'video_player', src: 'javascript:alert(1)' },
  ])
  assert.match(out, /<audio controls="" preload="metadata" src="\/a.mp3" aria-label="Intro"/)
  assert.match(out, /<figcaption[^>]*>Intro<\/figcaption>/)
  assert.match(out, /<video controls="" playsInline="" preload="metadata" src="\/v.mp4" poster="\/p.png" autoPlay=""/)
  assert.doesNotMatch(out, /javascript:/)
})

test('file_download: a download link styled as a button', () => {
  const out = html([{ type: 'file_download', label: 'Report', href: '/r.csv', filename: 'r.csv' }])
  assert.match(out, /<a href="\/r.csv" download="r.csv" data-slot="button"[^>]*>.*Report<\/a>/)
})

test('link: text link, link_button variant, page_link in place', () => {
  const out = html([
    { type: 'link', text: 'Docs', href: 'https://example.com', external: true },
    { type: 'link', text: 'Open', href: '/x', variant: 'primary' },
    { type: 'link', text: 'Sync', href: '/sync', page: 'sync' },
    { type: 'link', text: 'Ada', page: 'creator', params: { creator: 'ada' } },
    { type: 'link', text: 'Bad', href: 'javascript:alert(1)' },
  ])
  assert.match(out, /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer" class="w-fit/)
  assert.match(out, /<a href="\/x" data-slot="button" data-variant="default"[^>]*>Open<\/a>/)
  assert.match(out, /<a href="\/sync" class="w-fit[^"]*">Sync<\/a>/)
  assert.match(out, /<a href="\/creator\?creator=ada" class="w-fit[^"]*">Ada<\/a>/)
  assert.match(out, /<span class="w-fit text-sm text-foreground">Bad<\/span>/)
  const btns = html([{ type: 'button_group', buttons: [{ label: 'Inspect', page: 'creator', params: { creator: 'ada' }, variant: 'primary' }] }])
  assert.match(btns, /<a href="\/creator\?creator=ada"[^>]*>Inspect<\/a>/)
})

test('breadcrumb: links for earlier items, the last one is the current page', () => {
  const out = html([{ type: 'breadcrumb', items: [{ label: 'Home', href: '/' }, { label: 'Creators', page: 'creators' }, { label: 'Ada' }] }])
  assert.match(out, /<nav aria-label="breadcrumb"/)
  assert.match(out, /href="\/"[^>]*>Home<\/a>/)
  assert.match(out, /href="\/creators"[^>]*>Creators<\/a>/)
  assert.match(out, /aria-current="page"[^>]*>Ada<\/span>/)
})

test('tooltip_wrap: the child is a focusable trigger; an interactive child keeps its own tab stop', () => {
  const out = html([
    { type: 'tooltip_wrap', child: { type: 'badge', text: 'Beta' }, content: 'Not final' },
    { type: 'tooltip_wrap', child: { type: 'link', text: 'Go', href: '/go' }, content: 'Opens Go' },
  ])
  assert.match(out, /<span tabindex="0" class="inline-flex[^"]*" data-state="closed"[^>]*>.*Beta/)
  assert.match(out, /<span class="inline-flex[^"]*" data-state="closed"[^>]*><a href="\/go"/)
})

test('popover and dialog: closed triggers that announce what they open', () => {
  const out = html([
    { type: 'popover', trigger: { type: 'button', label: 'Filters' }, children: [{ type: 'text', content: 'inside' }] },
    { type: 'popover', trigger: { type: 'avatar', name: 'Ada Lovelace' }, children: [] },
    { type: 'dialog', title: 'Details', trigger_label: 'Open details', children: [{ type: 'text', content: 'secret' }] },
  ])
  assert.match(out, /aria-haspopup="dialog" aria-expanded="false"[^>]*>Filters<\/button>/)
  assert.match(out, /<span role="button" tabindex="0"[^>]*aria-haspopup="dialog"/)
  assert.match(out, /aria-haspopup="dialog" aria-expanded="false"[^>]*>Open details<\/button>/)
  assert.doesNotMatch(out, /inside|secret/, 'content renders only when open')
})

test('card_grid: cards with avatar, badges, stats and a stretched link; columns as a variable', () => {
  const out = html([
    {
      type: 'card_grid',
      columns: 4,
      items: [
        {
          title: 'Ada Lovelace',
          subtitle: '@ada',
          avatar: true,
          badges: ['Top 10', { text: 'Rising', variant: 'default' }],
          stats: [{ label: 'Subs', value: '1.2M' }, { label: 'Median', value: 41000 }],
          href: 'https://example.com/ada',
          target: '_blank',
        },
        { title: 'Grace', page: 'creator-grace', params: { tab: 'videos' }, image: '/g.png' },
        { title: 'Bad', href: 'javascript:alert(1)' },
      ],
    },
  ])
  assert.match(out, /--aiui-cols:4;--aiui-cols-md:2/)
  assert.match(out, /aria-label="Ada Lovelace"[^>]*>.*>AL<\/span>/)
  assert.match(out, /<a href="https:\/\/example.com\/ada" target="_blank" rel="noopener noreferrer" class="[^"]*after:inset-0">Ada Lovelace<\/a>/)
  assert.match(out, /<dt[^>]*>Subs<\/dt><dd[^>]*>1.2M<\/dd>/)
  assert.match(out, />Rising<\/span>/)
  assert.match(out, /<a href="\/creator-grace\?tab=videos"/)
  assert.match(out, /<img src="\/g.png" alt=""/)
  assert.doesNotMatch(out, /javascript:/)
})

test('color_picker_input: native color input with hex readout, name and auto_submit', () => {
  const out = html([
    { type: 'color_picker_input', label: 'Accent', name: 'accent', value: '#3b82f6', auto_submit: true },
  ])
  assert.match(out, /type="color"/)
  assert.match(out, /name="accent"/)
  assert.match(out, /data-auto-submit=""/)
  assert.match(out, /value="#3b82f6"/)
  assert.match(out, />#3b82f6</)
})

test('pagination: accessible nav with active page, prev/next and windowed ellipsis', () => {
  const out = html([{ type: 'pagination', total: 250, page: 5, per_page: 25, id: 'items' }])
  assert.match(out, /<nav[^>]*aria-label="Pagination"/)
  assert.match(out, /aria-label="Previous page"/)
  assert.match(out, /aria-label="Next page"/)
  assert.match(out, /aria-current="page"[^>]*>5</)
  assert.match(out, /aria-label="Page 10"/)
})
