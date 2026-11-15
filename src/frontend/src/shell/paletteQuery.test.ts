import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import {
  closeCommandPalette,
  openCommandPalette,
  toggleCommandPalette,
  useCommandPaletteOpen,
  useCommandPaletteQuery,
} from './palette'

function Probe() {
  return createElement('span', null, `${useCommandPaletteOpen()}|${useCommandPaletteQuery()}`)
}
const read = () => renderToStaticMarkup(createElement(Probe))

test('openCommandPalette({ query }) opens the palette prefilled; closing clears the query', () => {
  closeCommandPalette()
  openCommandPalette({ query: '@Researcher compare' })
  assert.equal(read(), '<span>true|@Researcher compare</span>')
  closeCommandPalette()
  assert.equal(read(), '<span>false|</span>')
})

test('a plain open (Ctrl+K, legacy callers, an event argument) starts empty', () => {
  closeCommandPalette()
  openCommandPalette()
  assert.equal(read(), '<span>true|</span>')
  closeCommandPalette()
  // dashboard.js and onClick handlers pass an event: it is ignored
  openCommandPalette(new Event('click'))
  assert.equal(read(), '<span>true|</span>')
  closeCommandPalette()
  toggleCommandPalette()
  assert.equal(read(), '<span>true|</span>')
  closeCommandPalette()
})

test('a new query while open replaces the text', () => {
  closeCommandPalette()
  openCommandPalette({ query: 'a' })
  openCommandPalette({ query: 'ab' })
  assert.equal(read(), '<span>true|ab</span>')
  closeCommandPalette()
})
