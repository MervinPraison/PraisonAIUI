// Shell services of the browser SDK (sdk/services.ts, sdk/notify.ts) and the
// export contract around them. Runs under node: `window` is globalThis with a
// minimal location/history, and fetch is stubbed per test.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { sdkApi } from '@/sdk/install'
import { SDK_EXPORTS, SDK_FEATURES, type ShellManifest } from '@/sdk/manifest'
import { requestToaster, useToasterRequested } from '@/sdk/notify'
import {
  activateShell,
  fetchJson,
  FetchJsonError,
  getCommands,
  getManifest,
  navigate,
  onActivate,
  provideShellHost,
  registerCommand,
  resetServicesForTests,
  type ShellCommand,
} from '@/sdk/services'

const g = globalThis as unknown as Record<string, unknown>
if (typeof g.window === 'undefined') g.window = globalThis

interface FakeLocation {
  href: string
  origin: string
  pathname: string
}
const location: FakeLocation = { href: 'http://app.test/overview', origin: 'http://app.test', pathname: '/overview' }
const historyCalls: [string, unknown, string][] = []
g.location = location
g.history = {
  pushState: (state: unknown, _t: string, url: string) => void historyCalls.push(['push', state, url]),
  replaceState: (state: unknown, _t: string, url: string) => void historyCalls.push(['replace', state, url]),
}

const manifest = (over: Partial<ShellManifest> = {}): ShellManifest => ({
  sdk: 1,
  version: '0.0.0',
  style: 'app',
  site: {},
  layout: {},
  pages: [{ id: 'overview', title: 'Overview', kind: 'legacy' }],
  blocks: [],
  toolRenderers: [],
  plugins: [],
  legacy: { customJs: null, viewsBase: '/plugins/views/' },
  ...over,
})

interface Call {
  url: string
  init: RequestInit
  headers: Headers
}

/** Replace window.fetch with one that records the call and answers `respond`. */
function stubFetch(respond: (url: string) => Response): Call[] {
  const calls: Call[] = []
  g.fetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init, headers: new Headers(init.headers) })
    return respond(url)
  }
  return calls
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function silenced<T>(method: 'warn' | 'error', fn: () => T | Promise<T>): Promise<{ result: T; logged: unknown[][] }> {
  const original = console[method]
  const logged: unknown[][] = []
  console[method] = (...args: unknown[]) => void logged.push(args)
  try {
    return { result: await fn(), logged }
  } finally {
    console[method] = original
  }
}

beforeEach(() => {
  resetServicesForTests()
  historyCalls.length = 0
  location.pathname = '/overview'
})

// ── export contract ──────────────────────────────────────────────────

test('the shell services are part of the frozen export list, appended after the registry', () => {
  const services = ['SDK_FEATURES', 'navigate', 'notify', 'fetchJson', 'useManifest', 'registerCommand', 'onActivate']
  assert.deepEqual(SDK_EXPORTS.slice(13, 20), services, 'additive: earlier names keep their place')
  assert.deepEqual(Object.keys(sdkApi), [...SDK_EXPORTS])
})

test('every @aiui/sdk export is a function, a hook, a component or a constant', () => {
  const constants: Record<string, (v: unknown) => boolean> = {
    SDK_VERSION: (v) => v === 1,
    SDK_FEATURES: (v) => Array.isArray(v) && v.every((f) => typeof f === 'string'),
  }
  const api = sdkApi as Record<string, unknown>
  for (const name of SDK_EXPORTS) {
    const value = api[name]
    if (constants[name]) {
      assert.ok(constants[name](value), `${name} is the expected constant`)
    } else if (/^[A-Z]/.test(name)) {
      // Components: functions, or memo/lazy/forwardRef objects.
      assert.ok(typeof value === 'function' || (typeof value === 'object' && value !== null), `${name} is a component`)
    } else {
      assert.equal(typeof value, 'function', `${name} is a function`)
    }
  }
})

test('SDK_FEATURES names each service, has no duplicates and SDK_VERSION stays 1', () => {
  assert.equal(sdkApi.SDK_VERSION, 1)
  assert.equal(sdkApi.SDK_FEATURES, SDK_FEATURES)
  assert.equal(new Set(SDK_FEATURES).size, SDK_FEATURES.length)
  for (const f of ['pages', 'blocks', 'tool-renderers', 'slots', 'navigate', 'notify', 'fetch-json', 'manifest', 'commands', 'activate']) {
    assert.ok((SDK_FEATURES as readonly string[]).includes(f), f)
  }
})

test('the published typings (aiui-sdk.d.ts) declare exactly SDK_EXPORTS', () => {
  const dts = readFileSync(path.resolve(process.cwd(), 'src/sdk/aiui-sdk.d.ts'), 'utf8')
  const declared = [...dts.matchAll(/^\s*export\s+(?:declare\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1])
  assert.deepEqual([...declared].sort(), [...SDK_EXPORTS].sort())
  assert.match(dts, /declare module '@aiui\/sdk'/)
  assert.doesNotMatch(dts, /^(import|export)\s/m, 'no top-level import/export: the file must stay ambient')
})

// ── navigate ─────────────────────────────────────────────────────────

test('navigate uses the history API without a shell, and the shell router once provided', () => {
  navigate('logs')
  assert.deepEqual(historyCalls, [['push', { pageId: 'logs' }, '/logs']])
  navigate('my page', { replace: true })
  assert.deepEqual(historyCalls[1], ['replace', { pageId: 'my page' }, '/my%20page'])
  navigate('overview')
  assert.equal(historyCalls.length, 2, 'already on /overview: no-op')

  const seen: unknown[][] = []
  provideShellHost({ navigate: (id, opts) => void seen.push([id, opts]) })
  navigate('usage', { replace: true })
  assert.deepEqual(seen, [['usage', { replace: true }]])
  assert.equal(historyCalls.length, 2, 'the provided router handled it')

  assert.throws(() => navigate(''), TypeError)
  assert.throws(() => navigate(undefined as unknown as string), TypeError)
})

// ── fetchJson ────────────────────────────────────────────────────────

test('fetchJson sends the token and cookies to same-origin URLs and decodes JSON', async () => {
  provideShellHost({ getToken: () => 'tok-123' })
  const calls = stubFetch(() => json({ ok: true, n: 2 }))
  const data = await fetchJson<{ ok: boolean; n: number }>('/api/plugins/hello/pages/x')
  assert.deepEqual(data, { ok: true, n: 2 })
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer tok-123')
  assert.equal(calls[0].headers.get('Accept'), 'application/json')
  assert.equal(calls[0].init.credentials, 'same-origin')
  assert.equal(calls[0].init.method, undefined, 'GET by default')
  assert.equal(calls[0].init.body, undefined)
})

test('fetchJson never sends the token cross-origin and keeps a caller Authorization header', async () => {
  provideShellHost({ getToken: () => 'tok-123' })
  const calls = stubFetch(() => json({}))
  await fetchJson('https://api.example.com/v1/x')
  assert.equal(calls[0].headers.get('Authorization'), null)
  assert.equal(calls[0].init.credentials, undefined)
  await fetchJson('/api/x', { headers: { Authorization: 'Bearer mine' } })
  assert.equal(calls[1].headers.get('Authorization'), 'Bearer mine')
  provideShellHost({ getToken: () => '' })
  await fetchJson('/api/x')
  assert.equal(calls[2].headers.get('Authorization'), null, 'no token stored: no header')
})

test('fetchJson encodes a plain body as JSON (POST) and passes raw bodies through', async () => {
  const calls = stubFetch(() => json({ saved: true }))
  await fetchJson('/api/x', { body: { action: 'greet', n: 1 } })
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.body, '{"action":"greet","n":1}')
  assert.equal(calls[0].headers.get('Content-Type'), 'application/json')

  await fetchJson('/api/x', { method: 'PUT', body: [1, 2] })
  assert.equal(calls[1].init.method, 'PUT')
  assert.equal(calls[1].init.body, '[1,2]')

  const form = new FormData()
  form.set('a', '1')
  await fetchJson('/api/x', { body: form })
  assert.equal(calls[2].init.body, form)
  assert.equal(calls[2].headers.get('Content-Type'), null, 'the browser sets the multipart boundary')

  await fetchJson('/api/x', { body: 'raw text', headers: { 'Content-Type': 'text/plain' } })
  assert.equal(calls[3].init.body, 'raw text')
  assert.equal(calls[3].headers.get('Content-Type'), 'text/plain')
})

test('fetchJson rejects a non-2xx response with status, url, body and the server message', async () => {
  stubFetch(() => json({ error: 'unknown action' }, 400))
  await assert.rejects(fetchJson('/api/x', { body: {} }), (err: unknown) => {
    assert.ok(err instanceof FetchJsonError)
    assert.equal(err.name, 'FetchJsonError')
    assert.equal(err.status, 400)
    assert.equal(err.url, '/api/x')
    assert.deepEqual(err.body, { error: 'unknown action' })
    assert.equal(err.message, 'unknown action')
    return true
  })
  stubFetch(() => new Response('<h1>Bad gateway</h1>', { status: 502 }))
  await assert.rejects(fetchJson('/api/x'), (err: unknown) => {
    assert.ok(err instanceof FetchJsonError)
    assert.equal(err.status, 502)
    assert.equal(err.body, '<h1>Bad gateway</h1>')
    assert.equal(err.message, 'Request to /api/x failed (502)')
    return true
  })
})

test('fetchJson resolves an empty response to undefined and rejects a 2xx that is not JSON', async () => {
  stubFetch(() => new Response(null, { status: 204 }))
  assert.equal(await fetchJson('/api/x', { method: 'DELETE' }), undefined)
  stubFetch(() => new Response('', { status: 200 }))
  assert.equal(await fetchJson('/api/x'), undefined)
  stubFetch(() => new Response('<!doctype html>', { status: 200 }))
  await assert.rejects(fetchJson('/api/x'), /is not JSON/)
  await assert.rejects(fetchJson(''), TypeError)
})

// ── onActivate + manifest ────────────────────────────────────────────

test('onActivate hooks wait for the shell, run once in order, and survive a failing hook', async () => {
  const calls: string[] = []
  onActivate(() => void calls.push('a'))
  onActivate(() => {
    throw new Error('boom')
  })
  const cancel = onActivate(() => void calls.push('cancelled'))
  onActivate(({ manifest: m }) => void calls.push(`c:${m.pages.length}`))
  cancel()
  assert.deepEqual([...calls], [], 'nothing runs before the shell has a manifest')
  assert.equal(getManifest(), null)

  const m = manifest()
  const { logged } = await silenced('error', () => activateShell(m))
  assert.deepEqual([...calls], ['a', 'c:1'])
  assert.equal(logged.length, 1)
  assert.match(String(logged[0][0]), /onActivate hook failed/)
  assert.equal(getManifest(), m)

  activateShell(m)
  assert.deepEqual([...calls], ['a', 'c:1'], 'hooks run once')

  // A plugin module imported after boot: the hook runs straight away.
  onActivate(({ manifest: now }) => void calls.push(`late:${now === m}`))
  assert.deepEqual([...calls], ['a', 'c:1', 'late:true'])
  assert.throws(() => onActivate('nope' as unknown as () => void), TypeError)
})

test('a hook registered by a hook still runs, and a new manifest is published without re-running hooks', () => {
  const calls: string[] = []
  onActivate(() => {
    calls.push('outer')
    onActivate(() => void calls.push('inner'))
  })
  activateShell(manifest())
  assert.deepEqual([...calls], ['outer', 'inner'])
  const next = manifest({ version: '2' })
  activateShell(next)
  assert.equal(getManifest(), next)
  assert.deepEqual([...calls], ['outer', 'inner'])
})

// ── commands ─────────────────────────────────────────────────────────

test('registerCommand lists commands in order, replaces by id and unregisters', async () => {
  assert.deepEqual(getCommands(), [])
  const empty = getCommands()
  const offA = registerCommand({ id: 'hello.greet', title: 'Say hello', run: () => {}, keywords: ['hi'] })
  registerCommand({ id: 'hello.open', title: 'Open Hello', group: 'Hello', run: () => {} })
  assert.notEqual(getCommands(), empty, 'a new snapshot after a change')
  assert.deepEqual(
    getCommands().map((c) => [c.id, c.group]),
    [
      ['hello.greet', undefined],
      ['hello.open', 'Hello'],
    ],
  )
  const snapshot = getCommands()
  assert.equal(getCommands(), snapshot, 'stable identity between changes (useSyncExternalStore)')
  assert.ok(Object.isFrozen(snapshot) && Object.isFrozen(snapshot[0]))

  const { logged } = await silenced('warn', () =>
    registerCommand({ id: 'hello.greet', title: 'Say hello again', run: () => {} }),
  )
  assert.equal(logged.length, 1, 'replacing warns')
  assert.equal(getCommands().find((c) => c.id === 'hello.greet')?.title, 'Say hello again')

  offA() // the handle of the replaced registration must not remove the new one
  assert.equal(getCommands().length, 2)
  const off = registerCommand({ id: 'tmp', title: 'Temp', run: () => {} })
  assert.equal(getCommands().length, 3)
  off()
  off()
  assert.deepEqual(getCommands().map((c) => c.id), ['hello.greet', 'hello.open'])
})

test('registerCommand validates its argument', () => {
  const bad = [null, {}, { id: 'x' }, { id: 'x', title: 'X' }, { id: '', title: 'X', run: () => {} }, { id: 'x', title: '', run: () => {} }]
  for (const c of bad) assert.throws(() => registerCommand(c as unknown as ShellCommand), TypeError)
  assert.deepEqual(getCommands(), [])
})

// ── notify ───────────────────────────────────────────────────────────

test('notify lives in the SDK and asks the host for its toaster', () => {
  assert.equal(typeof sdkApi.notify, 'function')
  assert.equal(typeof useToasterRequested, 'function')
  requestToaster()
  requestToaster() // idempotent
})
