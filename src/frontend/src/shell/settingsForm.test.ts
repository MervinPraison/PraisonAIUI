// The settings dialog's form helpers (shell/settingsForm.ts) and the plugin
// theme preset CSS (shell/themePresets.ts). Runs under plain node.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { NormalizedSettingsField } from '@/sdk/contributions'
import {
  fieldErrorsOf,
  fromDraft,
  getSettingsDialogState,
  openSettingsDialog,
  sameDraft,
  setSettingsDialogOpen,
  toDraft,
} from '@/shell/settingsForm'
import { presetCss } from '@/shell/themePresets'

const field = (over: Partial<NormalizedSettingsField>): NormalizedSettingsField => ({
  key: 'k',
  label: 'k',
  type: 'string',
  default: '',
  description: '',
  options: [],
  ...over,
})

const FIELDS = [
  field({ key: 'name', default: 'Ada' }),
  field({ key: 'count', type: 'number', default: 1 }),
  field({ key: 'on', type: 'boolean', default: false }),
  field({ key: 'mode', type: 'select', default: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }),
  field({ key: 'notes', type: 'text' }),
]

test('toDraft fills defaults for missing or stale values; fromDraft parses back', () => {
  const draft = toDraft(FIELDS, { name: 'Bob', count: 3, on: true, mode: 'gone' })
  assert.deepEqual(draft, { name: 'Bob', count: '3', on: true, mode: 'a', notes: '' })
  assert.deepEqual(fromDraft(FIELDS, { ...draft, count: ' 4.5 ', mode: 'b', notes: 'x\ny' }), {
    values: { name: 'Bob', count: 4.5, on: true, mode: 'b', notes: 'x\ny' },
    errors: {},
  })
  for (const bad of ['', 'four', 'Infinity']) {
    assert.deepEqual(fromDraft(FIELDS, { ...draft, count: bad }).errors, { count: 'Enter a number' }, bad)
  }
})

test('sameDraft compares every key; fieldErrorsOf reads a 400 body', () => {
  assert.equal(sameDraft({ a: '1', b: true }, { a: '1', b: true }), true)
  assert.equal(sameDraft({ a: '1' }, { a: '1', b: false }), false)
  assert.deepEqual(fieldErrorsOf({ body: { error: 'invalid settings', fields: { mode: 'expected one of a, b', n: 1 } } }), {
    mode: 'expected one of a, b',
  })
  assert.deepEqual(fieldErrorsOf(new Error('x')), {})
  assert.deepEqual(fieldErrorsOf(null), {})
})

test('openSettingsDialog marks the chunk requested and remembers the section', () => {
  assert.deepEqual(getSettingsDialogState(), { open: false, requested: false, sectionId: null })
  openSettingsDialog('hello.general')
  assert.deepEqual(getSettingsDialogState(), { open: true, requested: true, sectionId: 'hello.general' })
  setSettingsDialogOpen(false)
  // Closed, but the chunk stays mounted (requested) so reopening is instant.
  assert.deepEqual(getSettingsDialogState(), { open: false, requested: true, sectionId: 'hello.general' })
  openSettingsDialog()
  assert.equal(getSettingsDialogState().sectionId, null)
})

test('presetCss scopes light tokens away from dark mode and dark tokens to .dark', () => {
  const css = presetCss([
    { id: 'hello.sunrise', label: 'Sunrise', light: { '--seed-accent': '#ea580c' }, dark: { '--seed-accent': '#fb923c', '--radius': '0.75rem' } },
    { id: 'x.dark-only', label: 'D', light: {}, dark: { '--seed-paper': '#000' } },
  ])
  assert.equal(
    css,
    [
      'html[data-aiui-preset="hello.sunrise"]:not(.dark) { --seed-accent: #ea580c; }',
      'html[data-aiui-preset="hello.sunrise"].dark { --seed-accent: #fb923c; --radius: 0.75rem; }',
      'html[data-aiui-preset="x.dark-only"].dark { --seed-paper: #000; }',
    ].join('\n'),
  )
  assert.equal(presetCss([]), '')
})
