// What every frame shows of a plugin's own navigation (R2): the groups a
// plugin declared and the plugin settings entry.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LayoutNav, LayoutNavItem } from '@/sdk/layouts'
import { declaredGroups, DeclaredNavGroups, PluginSettingsRow } from '@/app-layouts/kit'

const item = (id: string, active = false): LayoutNavItem => ({ id, title: id, group: 'x', href: `/${id}`, active })

const NAV: Pick<LayoutNav, 'groups' | 'go'> = {
  groups: [
    { name: 'Work', folded: false, items: [item('jobs')] },
    { name: 'Hello', folded: false, declared: true, items: [item('hello'), item('hello-blocks')] },
    { name: 'Ops', folded: true, declared: true, items: [item('probe')] },
    { name: 'Empty', folded: false, declared: true, items: [] },
  ],
  go: () => {},
}

test('declaredGroups keeps the plugin-declared groups that list a page, in order', () => {
  assert.deepEqual(declaredGroups(NAV).map((g) => g.name), ['Hello', 'Ops'])
})

test('DeclaredNavGroups lists their pages, open or folded as declared', () => {
  const html = renderToStaticMarkup(createElement(DeclaredNavGroups, { nav: NAV }))
  assert.match(html, /href="\/hello"/)
  assert.match(html, /href="\/hello-blocks"/)
  assert.match(html, /href="\/probe"/)
  assert.doesNotMatch(html, /href="\/jobs"/, 'built-in groups stay in More')
  const sections = html.split('<details').slice(1)
  assert.equal(sections.length, 2)
  assert.match(sections[0], /^[^>]*\sopen=""/, 'Hello is declared open')
  assert.doesNotMatch(sections[1], /^[^>]*\sopen=""/, 'Ops is declared folded')
  // A folded group holding the page on screen opens.
  const onProbe = { ...NAV, groups: NAV.groups.map((g) => (g.name === 'Ops' ? { ...g, items: [item('probe', true)] } : g)) }
  const opened = renderToStaticMarkup(createElement(DeclaredNavGroups, { nav: onProbe })).split('<details').slice(1)
  assert.match(opened[1], /^[^>]*\sopen=""/)
  assert.equal(renderToStaticMarkup(createElement(DeclaredNavGroups, { nav: { ...NAV, groups: [NAV.groups[0]] } })), '')
})

test('PluginSettingsRow is drawn only while chrome.openSettings is set, and calls it', () => {
  assert.equal(renderToStaticMarkup(createElement(PluginSettingsRow, { chrome: {} })), '')
  const html = renderToStaticMarkup(createElement(PluginSettingsRow, { chrome: { openSettings: () => {} } }))
  assert.match(html, /Plugin settings/)
  assert.match(html, /aria-haspopup="dialog"/)
})
