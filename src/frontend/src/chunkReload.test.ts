// chunkReload.ts: reload on a failed chunk only for a real redeploy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createChunkErrorHandler, entryBuild, RELOAD_KEY, type ChunkReloadDeps } from './chunkReload'

const ENTRY = 'http://app.test/assets/index.js?v=abc123'
const page = (build: string) =>
  `<!doctype html><html data-aiui-shell="react"><head></head><body><div id="root"></div>` +
  `<script type="module" crossorigin src="/assets/index.js?v=${build}"></script></body></html>`

function harness(over: Partial<ChunkReloadDeps> = {}) {
  const store = new Map<string, string>()
  const calls = { reloads: 0, fetches: 0 }
  let online = true
  let onlineCb: (() => void) | null = null
  let html = page('abc123')
  const deps: ChunkReloadDeps = {
    entryUrl: ENTRY,
    isOnline: () => online,
    fetchPage: async () => {
      calls.fetches += 1
      if (!online) throw new TypeError('Failed to fetch')
      return html
    },
    onOnline: (cb) => {
      onlineCb = cb
    },
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
    reload: () => {
      calls.reloads += 1
    },
    ...over,
  }
  return {
    handle: createChunkErrorHandler(deps),
    calls,
    store,
    setOnline: (v: boolean) => {
      online = v
    },
    goOnline: () => {
      online = true
      const cb = onlineCb
      onlineCb = null
      cb?.()
    },
    serve: (build: string) => {
      html = page(build)
    },
  }
}

test('entryBuild reads the ?v= of /assets/index.js', () => {
  assert.equal(entryBuild(ENTRY), 'abc123')
  assert.equal(entryBuild(page('f00d.1')), 'f00d.1')
  assert.equal(entryBuild('<html>login</html>'), null)
  assert.equal(entryBuild('http://app.test/src/main.tsx'), null, 'dev server: no build id')
})

test('offline: no reload (no chrome-error page), and the check runs again once online', async () => {
  const h = harness()
  h.setOnline(false)
  await h.handle()
  assert.equal(h.calls.reloads, 0)
  assert.equal(h.calls.fetches, 0)
  // Back online and the server still runs this build: a transient failure, no reload.
  h.goOnline()
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(h.calls.fetches, 1)
  assert.equal(h.calls.reloads, 0)
})

test('online, same build: a transient failure, the page stays (Try again retries)', async () => {
  const h = harness()
  await h.handle()
  assert.equal(h.calls.fetches, 1)
  assert.equal(h.calls.reloads, 0)
  assert.equal(h.store.get(RELOAD_KEY), undefined)
})

test('a redeploy (the HTML names another build) reloads once per running build', async () => {
  const h = harness()
  h.serve('new999')
  await h.handle()
  assert.equal(h.calls.reloads, 1)
  assert.equal(h.store.get(RELOAD_KEY), ENTRY)
  await h.handle()
  assert.equal(h.calls.reloads, 1, 'never a second reload for the same build')
})

test('no reload when the HTML cannot be read, has no entry, or storage is missing', async () => {
  const unreachable = harness({ fetchPage: () => Promise.reject(new TypeError('Failed to fetch')) })
  await unreachable.handle()
  assert.equal(unreachable.calls.reloads, 0)

  const login = harness({ fetchPage: async () => '<html>sign in</html>' })
  await login.handle()
  assert.equal(login.calls.reloads, 0)

  const noStorage = harness({ storage: null })
  noStorage.serve('new999')
  await noStorage.handle()
  assert.equal(noStorage.calls.reloads, 0)

  const throwing = harness({
    storage: {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {},
    },
  })
  throwing.serve('new999')
  await throwing.handle()
  assert.equal(throwing.calls.reloads, 0)
})

test('several failures at once make one check', async () => {
  const h = harness()
  h.serve('new999')
  await Promise.all([h.handle(), h.handle(), h.handle()])
  assert.equal(h.calls.fetches, 1)
  assert.equal(h.calls.reloads, 1)
})
