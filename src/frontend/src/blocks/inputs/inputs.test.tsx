// Filter inputs (blocks/inputs): what they render and post, without a browser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BlockNode } from '@/sdk/registry'
import { MultiSelect, SearchableSelect } from './Combobox'
import { DateRangeInput, FilterBar, SegmentedInput, TagsInput } from './FilterInputs'

const node = (type: string, props: Record<string, unknown>, children?: BlockNode[]): BlockNode => ({ type, props, children })

test('searchable select: a labelled combobox button and the value in a hidden field', () => {
  const html = renderToStaticMarkup(
    <SearchableSelect node={node('select_input', { name: 'ch', label: 'Channel', options: ['a', { value: 'b', label: 'Bee' }], value: 'b' })} />,
  )
  assert.match(html, /role="combobox"/)
  assert.match(html, /aria-expanded="false"/)
  assert.match(html, /<input type="hidden"[^>]*name="ch"[^>]*value="b"/)
  assert.match(html, />Bee</)
})

test('multi-select and tags post JSON lists and show removable chips', () => {
  const ms = renderToStaticMarkup(<MultiSelect node={node('multiselect_input', { label: 'Tags', options: ['AI', 'ML'], value: ['AI'] })} />)
  assert.match(ms, /data-label="Tags" data-aiui-json="" value="\[&quot;AI&quot;\]"/)
  assert.match(ms, /aria-label="Remove AI"/)
  const tags = renderToStaticMarkup(<TagsInput node={node('tags_input', { name: 't', label: 'Tags', value: ['x'], auto_submit: true })} />)
  assert.match(tags, /data-auto-submit=""/)
  assert.match(tags, /data-aiui-json="" name="t"/)
  assert.doesNotMatch(tags, /<input aria-label=/, 'the draft box has no collect key')
})

test('date range: named start/end fields and preset pills', () => {
  const html = renderToStaticMarkup(
    <DateRangeInput node={node('date_range_input', { name: 'posted', label: 'Posted', start: '2026-01-01', end: '2026-02-01', presets: [7, 30] })} />,
  )
  assert.match(html, /name="posted_start"[^>]*value="2026-01-01"/)
  assert.match(html, /name="posted_end"[^>]*value="2026-02-01"/)
  assert.match(html, /aria-pressed="false"[^>]*>7 days</)
})

test('segmented: pills with aria-pressed; single choice defaults to the first option', () => {
  const html = renderToStaticMarkup(<SegmentedInput node={node('segmented_input', { name: 'p', options: ['all', 'yt'], value: '' })} />)
  assert.match(html, /value="all"/)
  assert.match(html, /aria-pressed="true"[^>]*>all</)
  const multi = renderToStaticMarkup(
    <SegmentedInput node={node('segmented_input', { name: 'p', options: ['a', 'b'], value: ['b'], multi: true })} />,
  )
  assert.match(multi, /value="\[&quot;b&quot;\]"/)
})

test('filter bar: a search form with chips and Reset for active filters', () => {
  const html = renderToStaticMarkup(
    <FilterBar
      node={node('filter_bar', { action: 'explore', reset_label: 'Clear all' }, [
        node('select_input', { name: 'creator', label: 'Creator', options: ['All', 'Ann'], value: 'Ann' }),
      ])}
    />,
  )
  assert.match(html, /<form role="search" aria-label="Filters"/)
  assert.match(html, /aria-label="Clear Creator: Ann"/)
  assert.match(html, />Clear all</)
  const getBar = renderToStaticMarkup(
    <FilterBar node={node('filter_bar', { method: 'get' }, [node('text_input', { name: 'q', label: 'Query', value: 'ai' })])} />,
  )
  assert.match(getBar, /<form role="search" aria-label="Filters"/)
  assert.match(getBar, /aria-label="Clear Query: ai"/)
})
