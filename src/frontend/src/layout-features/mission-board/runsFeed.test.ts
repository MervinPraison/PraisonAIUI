// The board's run feed over the run ledger routes (runsFeed.ts): shared
// pollers, visibility, refresh events, 404 = ledger off, nothing left
// running after the last unsubscribe.
import { afterEach, beforeEach, mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRunsFeed, hasStatus, REFRESH_EVENTS } from './runsFeed'

class FakeTarget {
  listeners = new Map<string, Set<() => void>>()
  visibilityState: DocumentVisibilityState = 'visible'
  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn)
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn)
  }
  fire(type: string) {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn()
  }
  count() {
    return [...this.listeners.values()].reduce((n, s) => n + s.size, 0)
  }
}

const flush = () => new Promise((r) => setImmediate(r))

beforeEach(() => mock.timers.enable({ apis: ['setInterval'] }))
afterEach(() => mock.timers.reset())

function setup(responses: Record<string, unknown | Error>) {
  const calls: string[] = []
  const doc = new FakeTarget()
  const win = new FakeTarget()
  const fetch = async <T>(url: string): Promise<T> => {
    calls.push(url)
    const key = Object.keys(responses).find((k) => url.startsWith(k))
    const body = key ? responses[key] : undefined
    if (body instanceof Error) throw body
    return body as T
  }
  const feed = createRunsFeed({ fetch, pollMs: 5000, doc: doc as unknown as Document, win: win as unknown as Window })
  return { feed, calls, doc, win }
}

const notFound = () => Object.assign(new Error('Not Found'), { status: 404 })

test('kpis and agents load on subscribe, poll every 5 s, and stop on the last unsubscribe', async () => {
  const { feed, calls, doc, win } = setup({
    '/api/runs/kpis': { window: 'today', runs: 3 },
    '/api/runs/agents': { agents: [{ name: 'Researcher', state: 'running' }] },
  })
  assert.equal(feed.status.get(), 'loading')
  const kpis = feed.kpis('today')
  assert.equal(kpis, feed.kpis('today'), 'one feed per key')
  const seen: number[] = []
  const off1 = kpis.subscribe(() => seen.push(kpis.get()?.runs ?? -1))
  const off2 = feed.agents().subscribe(() => {})
  await flush()
  assert.deepEqual(calls, ['/api/runs/kpis?window=today', '/api/runs/agents'])
  assert.equal(kpis.get()?.runs, 3)
  assert.deepEqual(feed.agents().get(), [{ name: 'Researcher', state: 'running' }])
  assert.equal(feed.status.get(), 'ok')
  assert.deepEqual(seen, [3])

  mock.timers.tick(5000)
  await flush()
  assert.equal(calls.length, 4)
  assert.deepEqual(seen, [3], 'an unchanged value does not notify')

  // Hidden tab: no polling; coming back refreshes at once.
  doc.visibilityState = 'hidden'
  mock.timers.tick(5000)
  await flush()
  assert.equal(calls.length, 4)
  doc.visibilityState = 'visible'
  doc.fire('visibilitychange')
  await flush()
  assert.equal(calls.length, 6)

  // An approval event refreshes too.
  win.fire(REFRESH_EVENTS[0])
  await flush()
  assert.equal(calls.length, 8)

  off1()
  off2()
  assert.equal(doc.count() + win.count(), 0, 'no listener left')
  mock.timers.tick(20_000)
  await flush()
  assert.equal(calls.length, 8, 'no polling after the last unsubscribe')
})

test('a 404 means the ledger is off: status off, and that feed stops asking', async () => {
  const { feed, calls } = setup({ '/api/runs/kpis': notFound() })
  const kpis = feed.kpis('today')
  const off = kpis.subscribe(() => {})
  await flush()
  assert.equal(feed.status.get(), 'off')
  assert.equal(kpis.get(), null)
  mock.timers.tick(10_000)
  await flush()
  assert.equal(calls.length, 1)
  off()
})

test('other errors keep polling and report error until a success', async () => {
  const responses: Record<string, unknown> = { '/api/runs/agents': new Error('boom') }
  const { feed } = setup(responses)
  const off = feed.agents().subscribe(() => {})
  await flush()
  assert.equal(feed.status.get(), 'error')
  responses['/api/runs/agents'] = { agents: [] }
  mock.timers.tick(5000)
  await flush()
  assert.equal(feed.status.get(), 'ok')
  off()
})

test('recent runs and run detail build their query; malformed bodies read as empty', async () => {
  const { feed, calls } = setup({ '/api/runs?': { runs: 'nope' }, '/api/runs/r 1': [1, 2] })
  const recent = feed.recent({ agent: 'Coder', after: 'r0' })
  const run = feed.run('r 1')
  const offs = [recent.subscribe(() => {}), run.subscribe(() => {})]
  await flush()
  assert.deepEqual(calls, ['/api/runs?after=r0&agent=Coder&limit=20', '/api/runs/r%201'])
  assert.deepEqual(recent.get(), [])
  assert.equal(run.get(), null)
  for (const off of offs) off()
  assert.equal(hasStatus(feed), true)
  assert.equal(hasStatus({ run: () => run, recent: () => recent, kpis: () => feed.kpis('today'), agents: () => feed.agents() }), false)
})
