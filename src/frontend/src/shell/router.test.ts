// Router tests (WP6). Run by scripts/run-tests.mjs (esbuild bundle + node --test)
// against a minimal window/history fake: no DOM library needed.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  LOCATION_CHANGE_EVENT,
  PAGE_CHANGE_EVENT,
  getPageId,
  navigate,
  pageIdFromPath,
  patchHistory,
  pathForPage,
  rewriteHashDeepLink,
  subscribeLocation,
  waitForPageChange,
} from '@/shell/router'

interface FakeWindow extends EventTarget {
  location: { readonly pathname: string; readonly search: string; readonly hash: string; readonly href: string }
  history: History & { back(): void; entries(): string[] }
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
}

/** A window with just enough location/history behaviour for router.ts. */
function installFakeWindow(startUrl: string): FakeWindow {
  const win = new EventTarget() as FakeWindow
  const entries: { url: URL; state: unknown }[] = [{ url: new URL(startUrl), state: null }]
  let index = 0
  const current = () => entries[index].url
  win.location = {
    get pathname() {
      return current().pathname
    },
    get search() {
      return current().search
    },
    get hash() {
      return current().hash
    },
    get href() {
      return current().href
    },
  }
  const history = {
    get state() {
      return entries[index].state
    },
    get length() {
      return entries.length
    },
    pushState(state: unknown, _title: string, url?: string | URL | null) {
      entries.splice(index + 1)
      entries.push({ url: new URL(String(url ?? current().href), current()), state })
      index = entries.length - 1
    },
    replaceState(state: unknown, _title: string, url?: string | URL | null) {
      entries[index] = { url: new URL(String(url ?? current().href), current()), state }
    },
    back() {
      if (index === 0) return
      index -= 1
      win.dispatchEvent(new Event('popstate'))
    },
    entries() {
      return entries.map((e) => e.url.pathname + e.url.search + e.url.hash)
    },
  }
  win.history = history as unknown as FakeWindow['history']
  win.setTimeout = setTimeout
  win.clearTimeout = clearTimeout
  ;(globalThis as { window?: unknown }).window = win
  return win
}

function countEvents(win: EventTarget, type: string): { readonly count: number; stop(): void } {
  let count = 0
  const fn = () => {
    count += 1
  }
  win.addEventListener(type, fn)
  return {
    get count() {
      return count
    },
    stop: () => win.removeEventListener(type, fn),
  }
}

let win: FakeWindow
beforeEach(() => {
  win = installFakeWindow('http://localhost:8000/')
})

test('pathname → page id uses the first path segment only', () => {
  assert.equal(pageIdFromPath('/'), '')
  assert.equal(pageIdFromPath(''), '')
  assert.equal(pageIdFromPath('/logs'), 'logs')
  assert.equal(pageIdFromPath('/logs/'), 'logs')
  assert.equal(pageIdFromPath('/runs/abc/def'), 'runs')
  assert.equal(pageIdFromPath('//chat'), 'chat')
  assert.equal(pageIdFromPath('/config_runtime'), 'config_runtime')
  assert.equal(pageIdFromPath('/code-studio'), 'code-studio')
  assert.equal(pageIdFromPath('/hello%20world'), 'hello world')
  assert.equal(pageIdFromPath('/%E0%A4'), '%E0%A4', 'malformed escapes fall back to the raw segment')
  assert.equal(pathForPage('jobs-board'), '/jobs-board')
  assert.equal(pathForPage('a b'), '/a%20b')
})

test('getPageId ignores the query string and hash', () => {
  win.history.replaceState(null, '', '/logs?level=error#tail')
  assert.equal(getPageId(), 'logs')
})

test('patched pushState/replaceState emit aiui:locationchange, and patching is idempotent', () => {
  patchHistory()
  patchHistory() // second call must not double-wrap
  const events = countEvents(win, LOCATION_CHANGE_EVENT)
  win.history.pushState(null, '', '/overview')
  assert.equal(events.count, 1)
  assert.equal(win.location.pathname, '/overview')
  win.history.replaceState(null, '', '/overview?tab=2')
  assert.equal(events.count, 2)
  assert.equal(win.location.search, '?tab=2')
  events.stop()
})

test('legacy hash deep link /#/logs?x=1 is rewritten to /logs?x=1 without a new history entry', () => {
  win = installFakeWindow('http://localhost:8000/#/logs?x=1')
  patchHistory()
  const events = countEvents(win, LOCATION_CHANGE_EVENT)
  assert.equal(rewriteHashDeepLink(), true)
  assert.equal(win.location.pathname, '/logs')
  assert.equal(win.location.search, '?x=1')
  assert.equal(win.location.hash, '')
  assert.equal(win.history.length, 1, 'replaceState, not pushState')
  assert.equal(events.count, 1, 'the router hears the rewrite')
  assert.equal(getPageId(), 'logs')
  events.stop()
})

test('hash deep links without a query, and non-matching hashes', () => {
  win = installFakeWindow('http://localhost:8000/#/replay')
  assert.equal(rewriteHashDeepLink(), true)
  assert.deepEqual(win.history.entries(), ['/replay'])

  win = installFakeWindow('http://localhost:8000/#section-2')
  assert.equal(rewriteHashDeepLink(), false)
  assert.equal(win.location.hash, '#section-2')

  win = installFakeWindow('http://localhost:8000/#/bad id')
  assert.equal(rewriteHashDeepLink(), false)

  // Only the site root carries legacy hash routes.
  win = installFakeWindow('http://localhost:8000/docs#/logs')
  assert.equal(rewriteHashDeepLink(), false)
  assert.equal(win.location.pathname, '/docs')
})

test('navigate pushes /<id>, is a no-op on the current page, and replace does not add an entry', () => {
  patchHistory()
  navigate('overview')
  assert.deepEqual(win.history.entries(), ['/', '/overview'])
  assert.deepEqual(win.history.state, { pageId: 'overview' })
  navigate('overview')
  assert.equal(win.history.length, 2, 'same page: no duplicate entry')
  win.history.replaceState(null, '', '/overview?x=1')
  navigate('overview')
  assert.equal(win.location.search, '?x=1', 'navigating to the current page keeps its query')
  navigate('logs', { replace: true })
  assert.deepEqual(win.history.entries(), ['/', '/logs'])
})

test('subscribeLocation fires on push, replace and back/forward until unsubscribed', () => {
  let calls = 0
  const off = subscribeLocation(() => {
    calls += 1
  })
  navigate('overview')
  navigate('logs')
  assert.equal(calls, 2)
  win.history.replaceState(null, '', '/logs?q=1')
  assert.equal(calls, 3)
  win.history.back() // popstate
  assert.equal(calls, 4)
  assert.equal(getPageId(), 'overview')
  off()
  navigate('usage')
  assert.equal(calls, 4)
})

test('waitForPageChange resolves on the matching aiui:page-change only', async () => {
  let done = false
  const p = waitForPageChange('chat', 1000).then(() => {
    done = true
  })
  win.dispatchEvent(new CustomEvent(PAGE_CHANGE_EVENT, { detail: { pageId: 'logs' } }))
  await Promise.resolve()
  assert.equal(done, false)
  win.dispatchEvent(new CustomEvent(PAGE_CHANGE_EVENT, { detail: { pageId: 'chat' } }))
  await p
  assert.equal(done, true)
})

test('waitForPageChange gives up after its timeout', async () => {
  const started = Date.now()
  await waitForPageChange('never', 20)
  assert.ok(Date.now() - started >= 15)
})
