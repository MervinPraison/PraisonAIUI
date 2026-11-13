// Behaviour tests for legacy/runtime.ts (WP4): the retry after a failed load.
//
// Browsers keep a failed module fetch in the module map for the life of the
// document: import() of the same URL rejects again without a new request.
// The in-thread module hooks below reproduce that. A dashboard.js URL that
// failed once keeps failing, so a retry only works if it asks for a new URL.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as nodeModule from 'node:module'

const PREFIX = 'file:///aiui-test'

interface Probe {
  requested: string[]
  evaluated: string[]
  bootCalls: number
  failBoot: boolean
}

const probe: Probe = { requested: [], evaluated: [], bootCalls: 0, failBoot: false }
const failedUrls = new Set<string>()
let failNextFetch = true

type Hooks = {
  resolve: (specifier: string, context: unknown, next: (s: string, c: unknown) => unknown) => unknown
  load: (url: string, context: unknown, next: (u: string, c: unknown) => unknown) => unknown
}
const registerHooks = (nodeModule as unknown as { registerHooks?: (hooks: Hooks) => unknown }).registerHooks

// A dashboard.js stand-in: counts evaluations, boot calls and can fail a boot.
const STUB_SOURCE = `
const probe = globalThis.__legacyProbe;
probe.evaluated.push(import.meta.url);
export async function initHostRuntime(opts) {
  probe.bootCalls += 1;
  probe.bootOpts = opts;
  if (probe.failBoot) throw new Error('boot failed (simulated)');
  return { pages: [{ id: 'overview' }] };
}
export async function mountView() { return () => {}; }
`

function installFakeBrowser(): void {
  const target = new EventTarget()
  const g = globalThis as unknown as Record<string, unknown>
  g.__legacyProbe = probe
  g.window = globalThis
  g.addEventListener = target.addEventListener.bind(target)
  g.removeEventListener = target.removeEventListener.bind(target)
  g.dispatchEvent = target.dispatchEvent.bind(target)
  g.location = { pathname: '/overview' }
  g.history = { pushState() {} }
  g.document = { querySelectorAll: () => [] }
  g.__AIUI_BUILD__ = 'b1'
}

if (registerHooks) {
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier.startsWith('/plugins/dashboard.js')) return { url: PREFIX + specifier, shortCircuit: true }
      return next(specifier, context)
    },
    load(url, context, next) {
      if (!url.startsWith(PREFIX)) return next(url, context)
      const path = url.slice(PREFIX.length)
      probe.requested.push(path)
      // Like Chromium: a URL whose fetch failed stays failed for the document.
      if (failedUrls.has(path)) throw new Error(`cached failure ${path}`)
      if (failNextFetch) {
        failNextFetch = false
        failedUrls.add(path)
        throw new Error(`HTTP 500 ${path} (simulated)`)
      }
      return { format: 'module', source: STUB_SOURCE, shortCircuit: true }
    },
  })
}

test(
  'a failed dashboard.js import is retried under a new URL; a loaded module is never imported again',
  { skip: registerHooks ? false : 'node:module registerHooks() needs Node >= 22.15' },
  async () => {
    installFakeBrowser()
    const { ensureLegacyRuntime } = await import('./runtime')

    // 1. The fetch fails (a 5xx or a network blip).
    await assert.rejects(ensureLegacyRuntime(), /HTTP 500/)
    assert.deepEqual(probe.requested, ['/plugins/dashboard.js?v=b1'])

    // 2. Retry: a fresh URL, so the browser fetches again. Make the boot fail
    //    this time, after the module itself loaded.
    probe.failBoot = true
    await assert.rejects(ensureLegacyRuntime(), /boot failed/)
    assert.deepEqual(probe.requested, ['/plugins/dashboard.js?v=b1', '/plugins/dashboard.js?v=b1&r=1'])
    assert.deepEqual(probe.evaluated, [`${PREFIX}/plugins/dashboard.js?v=b1&r=1`])

    // 3. Retry after a failed boot: the module already loaded is reused (no
    //    new URL, no second dashboard.js instance); only the boot runs again.
    probe.failBoot = false
    const runtime = await ensureLegacyRuntime()
    assert.deepEqual(runtime.pages, [{ id: 'overview' }])
    assert.equal(probe.requested.length, 2)
    assert.equal(probe.evaluated.length, 1)
    assert.equal(probe.bootCalls, 2)

    // 4. Once loaded it is a singleton.
    assert.equal(ensureLegacyRuntime(), ensureLegacyRuntime())
    await ensureLegacyRuntime()
    assert.equal(probe.requested.length, 2)
    assert.equal(probe.bootCalls, 2)
  },
)
