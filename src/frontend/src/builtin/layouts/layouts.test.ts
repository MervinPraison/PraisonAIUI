// builtin.layouts: registers the offered built-in layouts (lazily) and the
// layout picker (palette commands, Settings → Appearance).
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { sdkApi } from '@/sdk/install'
import { getLayoutComponent, getLayouts, resetLayoutsForTests } from '@/sdk/layouts'
import type { ShellLayouts } from '@/sdk/manifest'
import { getSettingsSections, getThemePresets } from '@/sdk/contributions'
import { getCommands, resetServicesForTests } from '@/sdk/services'
import { getLookChoice, setLookChoice } from '@/proTokens'
import { activateLayouts, APPEARANCE_SECTION_ID, BUILTIN_LAYOUTS, currentChoice, isBuiltinLayout, layoutChoices, layoutsBuiltin } from './index'

const g = globalThis as unknown as Record<string, unknown>
if (typeof g.window === 'undefined') g.window = globalThis

const offered = (over: Partial<ShellLayouts> = {}): ShellLayouts => ({
  default: 'chat-canvas',
  userChoice: true,
  available: [
    { id: 'chat-canvas', title: 'Chat + Canvas', source: 'builtin', order: 10 },
    { id: 'mission', title: 'Mission Control', source: 'builtin.layout-mission', order: 50 },
    { id: 'aurora', title: 'Aurora', source: 'plugin:aurora', module: '/_plugins/aurora/layout.js', order: 20 },
  ],
  ...over,
})

// The SDK, with every settings section it registers removed again before the next test.
const removers: (() => void)[] = []
const sdk: typeof sdkApi = Object.freeze({
  ...sdkApi,
  registerSettingsSection: (s: Parameters<typeof sdkApi.registerSettingsSection>[0]) => {
    const off = sdkApi.registerSettingsSection(s)
    removers.push(off)
    return off
  },
  registerThemePreset: (p: Parameters<typeof sdkApi.registerThemePreset>[0]) => {
    const off = sdkApi.registerThemePreset(p)
    removers.push(off)
    return off
  },
})

beforeEach(() => {
  resetLayoutsForTests()
  resetServicesForTests()
  for (const off of removers.splice(0)) off()
  setLookChoice('layout')
})

test('the five built-in layouts each have a descriptor with a lazy loader', () => {
  assert.deepEqual(
    BUILTIN_LAYOUTS.map((d) => d.id),
    ['chat-canvas', 'chat', 'workbench', 'command', 'guided', 'mission'],
  )
  for (const d of BUILTIN_LAYOUTS) {
    assert.ok(d.meta.title)
    assert.equal(typeof d.load, 'function')
    assert.equal(d.load.length, 0)
  }
  assert.equal(layoutsBuiltin.always, true)
  assert.deepEqual(layoutsBuiltin.pages, [])
})

test('only the offered built-in layouts register, without loading their frames; plugin layouts are left to the loader', () => {
  const loads: string[] = []
  const descriptors = BUILTIN_LAYOUTS.map((d) => ({
    ...d,
    load: () => {
      loads.push(d.id)
      return d.load()
    },
  }))
  assert.deepEqual(activateLayouts(sdk, offered(), descriptors), ['chat-canvas', 'mission'])
  assert.deepEqual(getLayouts().map((l) => l.id), ['chat-canvas', 'mission'])
  assert.ok(getLayoutComponent('chat-canvas'))
  assert.equal(getLayoutComponent('workbench'), undefined, 'not offered: not registered')
  assert.equal(getLayoutComponent('aurora'), undefined, 'a plugin layout registers through registerManifestLayouts')
  assert.deepEqual(loads, [], 'registering downloads no frame')
})

test('a plugin that took a disabled built-in’s id is not shadowed by the built-in descriptor', () => {
  const layouts = offered({ available: [{ id: 'mission', title: 'Their mission', source: 'plugin:ops', module: '/_plugins/ops/m.js' }] })
  assert.deepEqual(activateLayouts(sdk, layouts), [])
  assert.equal(isBuiltinLayout({ source: 'plugin:ops' }), false)
  assert.equal(isBuiltinLayout({ source: 'builtin.layout-mission' }), true)
})

test('no layouts key (an older server) registers nothing, not even the picker', () => {
  assert.deepEqual(activateLayouts(sdk, undefined), [])
  assert.deepEqual(activateLayouts(sdk, offered({ available: [] })), [])
  assert.equal(getCommands().length, 0)
  assert.equal(getSettingsSections().length, 0)
})

test('palette commands switch to each offered layout, plugin ones included, and to the classic frame', () => {
  activateLayouts(sdk, offered())
  const cmds = getCommands().filter((c) => c.group === 'Layout')
  assert.deepEqual(
    cmds.map((c) => c.title),
    [
      'Switch layout: Chat + Canvas',
      'Switch layout: Aurora',
      'Switch layout: Mission Control',
      'Switch layout: Classic',
      // Chat + Canvas paints with its own look (meta.look 'paper'); plain Pro is the other choice.
      'Switch look: Paper',
      'Switch look: Pro',
    ],
  )
  assert.deepEqual(cmds.map((c) => c.id).slice(-3), ['layouts.switch.classic', 'layouts.look.layout', 'layouts.look.pro'])
})

test('the look: "Switch look: Paper / Pro" save the viewer\'s choice; the host reads it', async () => {
  activateLayouts(sdk, offered())
  assert.equal(getLookChoice(), 'layout')
  await getCommands().find((c) => c.id === 'layouts.look.pro')!.run()
  assert.equal(getLookChoice(), 'pro')
  await getCommands().find((c) => c.id === 'layouts.look.layout')!.run()
  assert.equal(getLookChoice(), 'layout')
})

test('Settings → Appearance lists the same choices and reads the stored choice', async () => {
  activateLayouts(sdk, offered())
  const section = getSettingsSections().find((s) => s.id === APPEARANCE_SECTION_ID)!
  assert.equal(section.title, 'Appearance')
  assert.deepEqual(
    section.fields[0].options.map((o) => o.value),
    ['chat-canvas', 'aurora', 'mission', 'classic'],
  )
  assert.equal(section.fields[0].default, 'chat-canvas')
  assert.deepEqual(layoutChoices(offered()).at(-1), { id: '', title: 'Classic' })
  assert.equal(currentChoice(offered(), 'mission'), 'mission')
  assert.equal(currentChoice(offered(), ''), 'classic')
  assert.equal(currentChoice(offered(), 'gone'), 'chat-canvas')
  assert.equal(currentChoice(offered({ default: '' }), null), 'classic')
})

test('without a user choice there is no Appearance section (the server decides)', () => {
  activateLayouts(sdk, offered({ userChoice: false }))
  assert.equal(getSettingsSections().some((s) => s.id === APPEARANCE_SECTION_ID), false)
  assert.ok(getCommands().some((c) => c.group === 'Layout'), 'the tab-only switch stays in the palette')
})

test('no offered layout with a look: no look commands', () => {
  activateLayouts(sdk, offered({ available: [{ id: 'mission', title: 'Mission Control', source: 'builtin' }] }))
  assert.equal(getCommands().some((c) => c.id.startsWith('layouts.look.')), false)
})

test('the Pro accents are offered as theme presets that set only Pro seeds', () => {
  activateLayouts(sdk, offered())
  const pro = getThemePresets().filter((p) => p.id.startsWith('pro.'))
  assert.deepEqual(
    pro.map((p) => p.label),
    ['Pro Indigo', 'Pro Blue', 'Pro Teal', 'Pro Graphite'],
  )
  for (const p of pro) {
    for (const k of [...Object.keys(p.light), ...Object.keys(p.dark)]) assert.match(k, /^--seed-pro-/)
  }
})

test('no layout on offer, no Pro presets; an older shell without theme presets is skipped', () => {
  activateLayouts(sdk, offered({ available: [] }))
  assert.equal(getThemePresets().some((p) => p.id.startsWith('pro.')), false)
  const older = Object.freeze({ ...sdk, SDK_FEATURES: sdk.SDK_FEATURES.filter((f) => f !== 'theme-presets') }) as unknown as typeof sdk
  activateLayouts(older, offered())
  assert.equal(getThemePresets().some((p) => p.id.startsWith('pro.')), false)
})

test('the Chat layout (the Chat + Canvas frame without a canvas) paints with the same Paper look', () => {
  assert.equal(BUILTIN_LAYOUTS.find((d) => d.id === 'chat')?.meta.look, 'paper')
  assert.equal(BUILTIN_LAYOUTS.find((d) => d.id === 'chat-canvas')?.meta.look, 'paper')
  assert.equal(BUILTIN_LAYOUTS.find((d) => d.id === 'workbench')?.meta.look, undefined)
})
