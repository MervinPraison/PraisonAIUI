// Shell contributions (sdk/contributions.ts): settings sections, nav groups
// and theme presets, registered from @aiui/sdk or from a plugin's manifest
// record (the Python settings() / nav_groups() / themes() hooks).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sdkApi } from '@/sdk/install'
import { SDK_FEATURES, type ShellManifest } from '@/sdk/manifest'
import {
  getNavGroupDeclarations,
  getSettingsSections,
  getThemePresets,
  registerNavGroup,
  registerSettingsSection,
  registerThemePreset,
  seedManifestContributions,
} from '@/sdk/contributions'

const g = globalThis as unknown as Record<string, unknown>
if (typeof g.window === 'undefined') g.window = globalThis
g.location = { href: 'http://app.test/x', origin: 'http://app.test', pathname: '/x' }

const noop = {
  load: async () => ({}),
  save: async () => undefined,
}

test('the SDK module exports the contribution hooks and names their features', () => {
  assert.equal(sdkApi.registerSettingsSection, registerSettingsSection)
  assert.equal(sdkApi.registerNavGroup, registerNavGroup)
  assert.equal(sdkApi.registerThemePreset, registerThemePreset)
  for (const f of ['settings', 'nav-groups', 'theme-presets']) assert.ok(SDK_FEATURES.includes(f as never), f)
})

test('registerSettingsSection normalises fields, sorts by order and removes only its own entry', () => {
  const removeB = registerSettingsSection({
    id: 't.b',
    title: 'B',
    order: 20,
    fields: [{ key: 'name' }, { key: 'mode', type: 'select', options: ['a', { value: 'b', label: 'Bee' }] }],
    ...noop,
  })
  const removeA = registerSettingsSection({ id: 't.a', title: 'A', order: 10, fields: [{ key: 'on', type: 'boolean' }], ...noop })
  const list = getSettingsSections()
  assert.deepEqual(
    list.map((s) => s.id),
    ['t.a', 't.b'],
  )
  const [name, mode] = list[1].fields
  assert.deepEqual(name, { key: 'name', label: 'name', type: 'string', default: '', description: '', options: [] })
  assert.equal(mode.default, 'a')
  assert.deepEqual(mode.options, [
    { value: 'a', label: 'a' },
    { value: 'b', label: 'Bee' },
  ])
  assert.equal(list[0].fields[0].default, false)
  removeA()
  removeA() // a second call is harmless
  assert.deepEqual(
    getSettingsSections().map((s) => s.id),
    ['t.b'],
  )
  removeB()
  assert.equal(getSettingsSections().length, 0)
})

test('registerSettingsSection rejects what the shell could not render', () => {
  const bad: unknown[] = [
    null,
    { id: '', title: 'x', fields: [{ key: 'a' }], ...noop },
    { id: 'x', title: '', fields: [{ key: 'a' }], ...noop },
    { id: 'x', title: 'x', fields: [], ...noop },
    { id: 'x', title: 'x', fields: [{ key: 'a b' }], ...noop },
    { id: 'x', title: 'x', fields: [{ key: 'a', type: 'color' }], ...noop },
    { id: 'x', title: 'x', fields: [{ key: 'a', type: 'select' }], ...noop },
    { id: 'x', title: 'x', fields: [{ key: 'a', type: 'number', default: 'one' }], ...noop },
    { id: 'x', title: 'x', fields: [{ key: 'a' }, { key: 'a' }], ...noop },
    { id: 'x', title: 'x', fields: [{ key: 'a' }], load: noop.load },
  ]
  for (const s of bad) assert.throws(() => registerSettingsSection(s as never), TypeError, JSON.stringify(s))
  assert.equal(getSettingsSections().length, 0)
})

test('registerNavGroup keeps one declaration per name (the latest)', () => {
  const remove = registerNavGroup('Reports', { order: 150 })
  const removeLatest = registerNavGroup(' Reports ', { order: 250, folded: true })
  assert.deepEqual(getNavGroupDeclarations(), [{ name: 'Reports', order: 250, folded: true }])
  remove() // the first registration was replaced: nothing to remove
  assert.equal(getNavGroupDeclarations().length, 1)
  removeLatest()
  assert.equal(getNavGroupDeclarations().length, 0)
  assert.throws(() => registerNavGroup(''), TypeError)
  assert.throws(() => registerNavGroup('X', { order: Number.NaN }), TypeError)
})

test('registerThemePreset accepts seed tokens only, with safe values', () => {
  const remove = registerThemePreset({ id: 't.sun', label: 'Sun', light: { '--seed-accent': '#ea580c' }, dark: { 'seed-accent': 'oklch(0.7 0.2 50)' } })
  assert.deepEqual(getThemePresets(), [
    { id: 't.sun', label: 'Sun', light: { '--seed-accent': '#ea580c' }, dark: { '--seed-accent': 'oklch(0.7 0.2 50)' } },
  ])
  remove()
  const unsafe: Record<string, string>[] = [
    { '--background': '#fff' },
    { '--seed-accent': 'red;}html{color:red' },
    { '--seed-paper': 'url(/x.png)' },
    {},
  ]
  for (const light of unsafe) {
    assert.throws(() => registerThemePreset({ id: 't.bad', label: 'Bad', light }), TypeError, JSON.stringify(light))
  }
  assert.throws(() => registerThemePreset({ id: 'has space', label: 'x', light: { '--radius': '0' } }), TypeError)
})

test('seedManifestContributions registers the Python hooks of served plugins, prefixed with the plugin name', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  g.fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const body = init?.method === 'PUT' ? JSON.parse(String(init.body)) : { values: { greeting: 'Hi' } }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const manifest = {
    plugins: [
      {
        name: 'hello',
        status: 'ok',
        settings: [
          { id: 'general', title: 'General', fields: [{ key: 'greeting', default: 'Hello' }], endpoint: '/api/plugins/hello/settings/general' },
          { id: 'broken', title: 'Broken', fields: [], endpoint: '/x' },
        ],
        navGroups: [{ name: 'Hello', order: 250, folded: false }, { name: '' }],
        themes: [{ id: 'sunrise', label: 'Sunrise', light: { '--seed-accent': '#ea580c' } }],
      },
      { name: 'off', status: 'disabled-by-default', navGroups: [{ name: 'Off' }] },
    ],
  } as unknown as ShellManifest
  const warn = console.warn
  console.warn = () => {}
  try {
    seedManifestContributions(manifest)
    seedManifestContributions(manifest) // once per manifest
  } finally {
    console.warn = warn
  }
  const [section] = getSettingsSections()
  assert.equal(getSettingsSections().length, 1)
  assert.equal(section.id, 'hello.general')
  assert.deepEqual(getNavGroupDeclarations(), [{ name: 'Hello', order: 250, folded: false }])
  assert.deepEqual(
    getThemePresets().map((p) => p.id),
    ['hello.sunrise'],
  )

  assert.deepEqual(await section.load(), { greeting: 'Hi' })
  assert.deepEqual(await section.save({ greeting: 'Yo' }), { greeting: 'Yo' })
  assert.equal(calls[1].url, '/api/plugins/hello/settings/general')
  assert.equal(calls[1].init?.method, 'PUT')
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { values: { greeting: 'Yo' } })
})
