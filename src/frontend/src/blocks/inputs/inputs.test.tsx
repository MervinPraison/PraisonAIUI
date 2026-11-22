// Filter inputs (blocks/inputs): what they render and post, without a browser.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BlockNode } from '@/sdk/registry'
import { SearchableSelect } from './Combobox'
import { FilterBar } from './FilterBar'

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
})
