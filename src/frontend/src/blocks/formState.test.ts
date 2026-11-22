// Form logic for form / filter_bar and the filter inputs (blocks/formState.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { BlockNode } from '@/sdk/registry'
import { addTags, autoSubmitKind, filterChips, filterOptions, isSearchable, optionList, presetList, presetRange, INPUT_CHANGE } from './formState'

const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ value: `c${i}`, label: `Channel ${i}` }))

test('searchable: explicit flag wins, else more than 20 options', () => {
  assert.equal(isSearchable({ options: opts(20) }), false)
  assert.equal(isSearchable({ options: opts(21) }), true)
  assert.equal(isSearchable({ options: opts(500), searchable: false }), false)
  assert.equal(isSearchable({ options: ['a'], searchable: true }), true)
})

test('filterOptions: 1,095 options render at most the limit, prefix matches first', () => {
  const all = opts(1095)
  const none = filterOptions(all, '')
  assert.equal(none.items.length, 100)
  assert.equal(none.more, 995)
  const q = filterOptions([{ value: 'x', label: 'The AI show' }, { value: 'y', label: 'AI weekly' }], 'ai')
  assert.deepEqual(q.items.map((o) => o.value), ['y', 'x'])
  assert.equal(filterOptions(all, 'channel 1094').items[0].value, 'c1094')
  const t0 = performance.now()
  for (let i = 0; i < 50; i++) filterOptions(all, 'nel 7')
  assert.ok(performance.now() - t0 < 250, 'filtering 1,095 options stays well under a frame')
})

test('optionList takes strings and {value,label} dicts', () => {
  assert.deepEqual(optionList(['a', { value: 'b', label: 'Bee' }]), [
    { value: 'a', label: 'a' },
    { value: 'b', label: 'Bee' },
  ])
})

test('presets: day counts and dicts; a range ends today', () => {
  assert.deepEqual(presetList([7, { days: 14, label: '2 weeks' }, 365, 'x', -1]), [
    { days: 7, label: '7 days' },
    { days: 14, label: '2 weeks' },
    { days: 365, label: '1 year' },
  ])
  assert.deepEqual(presetRange(30, new Date(2026, 2, 15)), { start: '2026-02-13', end: '2026-03-15' })
})

test('addTags splits on commas, trims and drops blanks and duplicates', () => {
  assert.deepEqual(addTags(['ai'], ' ml, ai,, nlp '), ['ai', 'ml', 'nlp'])
})

function ev(type: string, target: Partial<Element> & { name?: string }, detail?: unknown): Event {
  return { type, target, detail } as unknown as Event
}
const field = (auto: boolean) => ({ name: 'q', dataset: {}, getAttribute: () => null, closest: () => (auto ? {} : null) })

test('autoSubmitKind: only on change forms or marked inputs; text debounces', () => {
  assert.equal(autoSubmitKind(ev('change', field(false)), false), null)
  assert.equal(autoSubmitKind(ev('change', field(false)), true), 'now')
  assert.equal(autoSubmitKind(ev('input', field(true)), false), 'debounce')
  assert.equal(autoSubmitKind(ev(INPUT_CHANGE, field(true), {}), false), 'now')
  const draft = { name: '', dataset: {}, getAttribute: () => null, closest: () => ({}) }
  assert.equal(autoSubmitKind(ev('input', draft), true), null, 'a chip box draft is not a value')
})

const node = (type: string, props: Record<string, unknown>): BlockNode => ({ type, props })

test('filterChips: one chip per active filter, reset values for all', () => {
  const nodes = [
    node('select_input', { name: 'creator', label: 'Creator', options: ['All', 'Ann', 'Bo'], value: 'Bo' }),
    node('select_input', { name: 'sort', label: 'Sort', options: ['views', 'date'], value: 'views' }),
    node('multiselect_input', { name: 'fmt', label: 'Format', options: [{ value: 'v', label: 'Video' }, 'post'], value: ['v', 'post'] }),
    node('date_range_input', { name: 'posted', label: 'Posted', start: '2026-01-01', end: '' }),
    node('segmented_input', { name: 'p', label: 'Platform', options: ['all', 'yt'], value: '' }),
    node('checkbox_input', { name: 'mine', label: 'Mine', checked: true }),
    node('text_input', { name: 'q', label: 'Search', value: '' }),
    node('number_input', { name: 'n', label: 'Limit', value: 50 }),
  ]
  const { chips, reset } = filterChips(nodes, {})
  assert.deepEqual(
    chips.map((c) => `${c.label}=${c.text}`),
    ['Creator=Bo', 'Format=Video', 'Format=post', 'Posted=2026-01-01 – …', 'Mine=on'],
  )
  assert.deepEqual(chips[1].patch, { fmt: ['post'] })
  assert.deepEqual(chips[3].patch, { posted_start: '', posted_end: '' })
  assert.deepEqual(reset, { creator: 'All', sort: 'views', fmt: [], posted_start: '', posted_end: '', p: 'all', mine: false, q: '' })
  const withDefaults = filterChips(nodes, { creator: 'Bo', n: 20 })
  assert.deepEqual(withDefaults.chips.map((c) => c.key).slice(0, 1), ['fmt:v'])
  assert.ok(withDefaults.chips.some((c) => c.key === 'n' && c.text === '50'))
})
