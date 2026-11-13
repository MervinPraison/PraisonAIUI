// First-party browser plugins (src/builtin): they register through the public
// SDK object, once, and a broken one does not stop the others.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activateBuiltins, BUILTIN_PLUGINS, resetBuiltinsForTests, type BuiltinPlugin } from '@/builtin'
import { sdkApi } from '@/sdk/install'
import { getPage } from '@/sdk/registry'

const g = globalThis as unknown as Record<string, unknown>
if (typeof g.window === 'undefined') g.window = globalThis
if (typeof g.addEventListener !== 'function') {
  g.addEventListener = () => {}
  g.removeEventListener = () => {}
}

test('built-in names are unique, namespaced and each one owns at least one page', () => {
  const names = BUILTIN_PLUGINS.map((b) => b.name)
  assert.equal(new Set(names).size, names.length)
  for (const b of BUILTIN_PLUGINS) {
    assert.match(b.name, /^builtin\.[a-z][a-z0-9-]*$/)
    assert.ok(b.pages.length > 0, `${b.name} lists its pages`)
  }
  const ids = BUILTIN_PLUGINS.flatMap((b) => b.pages)
  assert.equal(new Set(ids).size, ids.length, 'no page id is claimed twice')
})

test('activation hands each built-in the public sdk, once, and isolates a failure', () => {
  resetBuiltinsForTests()
  const calls: string[] = []
  const errors: unknown[][] = []
  const original = console.error
  console.error = (...args: unknown[]) => void errors.push(args)
  const plugins: BuiltinPlugin[] = [
    {
      name: 'builtin.broken',
      pages: ['broken'],
      activate() {
        throw new Error('boom')
      },
    },
    {
      name: 'builtin.ok',
      pages: ['ok'],
      activate(sdk) {
        assert.equal(sdk, sdkApi)
        calls.push('ok')
      },
    },
  ]
  try {
    assert.deepEqual(activateBuiltins(sdkApi, plugins), ['builtin.ok'])
    assert.deepEqual(activateBuiltins(sdkApi, plugins), [], 'a second call activates nothing')
  } finally {
    console.error = original
  }
  assert.deepEqual(calls, ['ok'])
  assert.equal(errors.length, 1)
  assert.match(String(errors[0][0]), /builtin\.broken failed to activate/)
})

test('the chat page is registered by builtin.chat, not by the shell', () => {
  resetBuiltinsForTests()
  assert.equal(getPage('chat'), undefined)
  assert.deepEqual(activateBuiltins(), ['builtin.chat'])
  assert.ok(getPage('chat'), 'chat resolves through the SDK registry')
})
