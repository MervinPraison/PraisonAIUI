// themes.ts colour-mode preference on the pre-shell React path (styles chat,
// docs, ...): 'system' follows OS changes, other modes do not.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyStoredThemePreference, setThemePreference, THEME_STORAGE_KEY } from '@/themes'

const g = globalThis as unknown as Record<string, unknown>
const classes = new Set<string>()
g.document = { documentElement: { classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) } } }
const store = new Map<string, string>()
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }

let osDark = true
const listeners = new Set<() => void>()
const query = {
  get matches() {
    return osDark
  },
  addEventListener: (_: string, fn: () => void) => void listeners.add(fn),
  removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn),
}
g.window = { matchMedia: () => query }
const osSwitches = (dark: boolean) => {
  osDark = dark
  for (const fn of [...listeners]) fn()
}
const dark = () => classes.has('dark')

test("'system' follows the OS scheme when it changes, until another mode is chosen", () => {
  osDark = true
  setThemePreference('system')
  assert.equal(store.get(THEME_STORAGE_KEY), 'system')
  assert.equal(dark(), true)
  osSwitches(false)
  assert.equal(dark(), false, 'the OS went light: so does the page')
  osSwitches(true)
  assert.equal(dark(), true)

  setThemePreference('light')
  assert.equal(dark(), false)
  assert.equal(listeners.size, 0, 'light mode stops listening')
  osSwitches(false)
  osSwitches(true)
  assert.equal(dark(), false, 'an explicit mode ignores the OS')

  setThemePreference('system')
  setThemePreference('system')
  assert.equal(listeners.size, 1, 'one listener, however often it is chosen')
  setThemePreference('dark')
  assert.equal(listeners.size, 0)
})

test('a stored system preference follows the OS from page load; no preference uses the YAML default', () => {
  store.set(THEME_STORAGE_KEY, 'system')
  osDark = false
  applyStoredThemePreference(true)
  assert.equal(dark(), false)
  osSwitches(true)
  assert.equal(dark(), true)

  store.delete(THEME_STORAGE_KEY)
  applyStoredThemePreference(false)
  assert.equal(dark(), false)
  assert.equal(listeners.size, 0)
  applyStoredThemePreference(true)
  assert.equal(dark(), true)
})
