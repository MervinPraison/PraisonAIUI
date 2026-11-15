// The command bar: `/` and `>` open the palette with the rest, plain text
// asks the chat; the bar renders its agent chip, label and key hints.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { barIntent } from './bar'
import CommandBar from './CommandBar'

test('barIntent: commands, questions and nothing', () => {
  assert.deepEqual(barIntent('/new chat'), { kind: 'palette', query: 'new chat' })
  assert.deepEqual(barIntent('  > logs'), { kind: 'palette', query: 'logs' })
  assert.deepEqual(barIntent('/'), { kind: 'palette', query: '' })
  assert.deepEqual(barIntent(' Compare sorting algorithms '), { kind: 'ask', text: 'Compare sorting algorithms' })
  assert.deepEqual(barIntent('a/b test'), { kind: 'ask', text: 'a/b test' }, 'a slash inside the text is not a command')
  assert.deepEqual(barIntent('   '), { kind: 'none' })
})

test('the bar: a search landmark, a labelled input, the agent chip on desktop only', () => {
  const props = { openPalette: () => {}, onAsk: () => {}, agent: 'Researcher' }
  const desk = renderToStaticMarkup(createElement(CommandBar, props))
  assert.match(desk, /role="search"/)
  assert.match(desk, /<label for="([^"]+)" class="sr-only">Ask or run a command<\/label><input[^>]*id="\1"/)
  assert.match(desk, /placeholder="Ask or run a command…"/)
  assert.match(desk, /data-command-bar-agent="true">@Researcher</)
  assert.match(desk, /h-10/)
  const phone = renderToStaticMarkup(createElement(CommandBar, { ...props, size: 'touch' }))
  assert.doesNotMatch(phone, /data-command-bar-agent/)
  assert.match(phone, /h-11/)
  assert.match(phone, /text-base/, 'phone body size')
})
