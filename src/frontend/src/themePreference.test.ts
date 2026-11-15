// themes.ts colour-mode preference on the pre-shell React path (styles chat,
// docs, ...): 'system' follows OS changes, other modes do not.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyStoredThemePreference, defaultThemeMode, setThemePreference, THEME_STORAGE_KEY } from '@/themes'

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

test('a stored system preference follows the OS from page load; no preference uses the app default', () => {
  store.set(THEME_STORAGE_KEY, 'system')
  osDark = false
  applyStoredThemePreference('dark')
  assert.equal(dark(), false)
  osSwitches(true)
  assert.equal(dark(), true)

  store.delete(THEME_STORAGE_KEY)
  applyStoredThemePreference('light')
  assert.equal(dark(), false)
  assert.equal(listeners.size, 0)
  applyStoredThemePreference('dark')
  assert.equal(dark(), true)
})

test("an app that chose no mode follows the OS from page load and live (the chat style's default)", () => {
  store.delete(THEME_STORAGE_KEY)
  osDark = false
  // What `aiui run app.py` serves: the dark fill-in plus mode 'system'.
  const served = { preset: 'zinc', darkMode: true, radius: 'md', mode: 'system' }
  applyStoredThemePreference(defaultThemeMode(served))
  assert.equal(dark(), false, 'light OS: light page')
  osSwitches(true)
  assert.equal(dark(), true, 'the OS went dark: so does the page')
  osSwitches(false)
  assert.equal(dark(), false)

  // An explicit app mode beats the OS; the viewer's stored choice beats both.
  applyStoredThemePreference(defaultThemeMode({ darkMode: false, mode: 'light' }))
  osSwitches(true)
  assert.equal(dark(), false, 'set_theme(dark_mode=False) stays light on a dark OS')
  assert.equal(listeners.size, 0)
  store.set(THEME_STORAGE_KEY, 'dark')
  applyStoredThemePreference('light')
  assert.equal(dark(), true, 'the stored toggle choice wins over the app default')
  store.delete(THEME_STORAGE_KEY)
})

test('defaultThemeMode: the server mode first, else a static build\'s darkMode', () => {
  assert.equal(defaultThemeMode({ mode: 'system', darkMode: true }), 'system')
  assert.equal(defaultThemeMode({ mode: 'light', darkMode: true }), 'light')
  assert.equal(defaultThemeMode({ mode: 'dark', darkMode: false }), 'dark')
  assert.equal(defaultThemeMode({ mode: 'bogus', darkMode: false }), 'light')
  assert.equal(defaultThemeMode({ darkMode: true }), 'dark')
  assert.equal(defaultThemeMode({ darkMode: false }), 'light')
  assert.equal(defaultThemeMode({}), 'dark', 'aiui build without darkMode keeps its dark default')
  assert.equal(defaultThemeMode(undefined), 'dark')
})
