// Tests for sdk/liveData.ts: keyed abort on navigation, retained last data on
// refresh failure, visibility-aware polling, overdue tab refresh, non-overlap,
// exponential backoff, and dynamic interval resolution.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  createLiveDataController,
  DEFAULT_MAX_BACKOFF_MS,
  nextRefreshDelayMs,
  useLiveData,
  type LiveDataEnv,
  type LiveDataErrorInfo,
} from './liveData'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise<void>((r) => setImmediate(r))

function createFakeEnv() {
  let clock = 1_000_000
  let hidden = false
  let nextId = 1
  const timers = new Map<number, { at: number; ms: number; fn: () => void }>()
  const visListeners = new Set<() => void>()

  const env: LiveDataEnv = {
    now: () => clock,
    setTimeout: (fn, ms) => {
      const id = nextId++
      timers.set(id, { at: clock + ms, ms, fn })
      return id as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeout: (id) => {
      if (id !== undefined) timers.delete(id as unknown as number)
    },
    isHidden: () => hidden,
    addVisibilityListener: (fn) => {
      visListeners.add(fn)
      return () => visListeners.delete(fn)
    },
  }

  return {
    env,
    now: () => clock,
    advance: async (ms: number) => {
      clock += ms
      const due = [...timers.entries()].filter(([, t]) => t.at <= clock)
      for (const [id, t] of due) {
        timers.delete(id)
        t.fn()
      }
      await flush()
    },
    setHidden: async (next: boolean) => {
      hidden = next
      for (const fn of [...visListeners]) fn()
      await flush()
    },
    pendingTimers: () => [...timers.values()].map((t) => t.ms),
    visibilityListenerCount: () => visListeners.size,
  }
}

test('nextRefreshDelayMs doubles per failure and caps at maxBackoffMs', () => {
  assert.equal(nextRefreshDelayMs(5_000, 0), 5_000)
  assert.equal(nextRefreshDelayMs(5_000, 1), 10_000)
  assert.equal(nextRefreshDelayMs(5_000, 3), 40_000)
  assert.equal(nextRefreshDelayMs(5_000, 50), DEFAULT_MAX_BACKOFF_MS)
  assert.equal(nextRefreshDelayMs(200, 0), 1_000, 'clamps below minimum 1s')
  assert.equal(nextRefreshDelayMs(600_000, 2), 600_000, 'never shortens an interval above the cap')
})

test('switching keys during a slow read aborts the previous request and never shows old data', async () => {
  const fake = createFakeEnv()
  const requests: Array<{ key: string; signal: AbortSignal; d: Deferred<string> }> = []

  const ctrl = createLiveDataController<string>(
    {
      key: 'focus',
      fetcher: (signal) => {
        const d = deferred<string>()
        requests.push({ key: 'focus', signal, d })
        return d.promise
      },
      intervalMs: 0,
      maxBackoffMs: DEFAULT_MAX_BACKOFF_MS,
      enabled: true,
    },
    fake.env,
  )

  ctrl.start()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].signal.aborted, false)

  // Navigate to 'revenue' before 'focus' resolves.
  ctrl.updateConfig({
    key: 'revenue',
    fetcher: (signal) => {
      const d = deferred<string>()
      requests.push({ key: 'revenue', signal, d })
      return d.promise
    },
    intervalMs: 0,
    maxBackoffMs: DEFAULT_MAX_BACKOFF_MS,
    enabled: true,
  })

  assert.equal(requests[0].signal.aborted, true, 'previous request aborted on key change')
  assert.equal(ctrl.getSnapshot().key, 'revenue')
  assert.equal(ctrl.getSnapshot().hasData, false)
  assert.equal(ctrl.getSnapshot().data, undefined)

  // Even if the slow fetcher ignores AbortSignal and resolves late, it must be dropped.
  requests[0].d.resolve('STALE FOCUS DATA')
  await flush()
  assert.equal(ctrl.getSnapshot().key, 'revenue')
  assert.equal(ctrl.getSnapshot().data, undefined)

  // Resolving the new page shows the new page's data.
  requests[1].d.resolve('REVENUE DATA')
  await flush()
  assert.equal(ctrl.getSnapshot().data, 'REVENUE DATA')
  assert.equal(ctrl.getSnapshot().hasData, true)
  ctrl.dispose()
})

test('a failed refresh retains the last successful result and timestamp alongside the error', async () => {
  const fake = createFakeEnv()
  let attempt = 0
  const errors: Array<{ message: string; info: LiveDataErrorInfo }> = []

  const ctrl = createLiveDataController<{ total: number }>(
    {
      key: 'revenue',
      fetcher: async () => {
        attempt += 1
        if (attempt === 1) return { total: 4200 }
        throw new Error('Upstream unavailable')
      },
      intervalMs: 0,
      maxBackoffMs: DEFAULT_MAX_BACKOFF_MS,
      enabled: true,
      onError: (err, info) => errors.push({ message: err.message, info }),
    },
    fake.env,
  )

  ctrl.start()
  await flush()
  const firstAt = ctrl.getSnapshot().updatedAt
  assert.deepEqual(ctrl.getSnapshot().data, { total: 4200 })
  assert.equal(ctrl.getSnapshot().error, null)
  assert.ok(firstAt !== null)

  await fake.advance(30_000)
  await ctrl.refresh()

  const snap = ctrl.getSnapshot()
  assert.deepEqual(snap.data, { total: 4200 }, 'last successful data stays visible')
  assert.equal(snap.updatedAt, firstAt, 'original timestamp preserved on failure')
  assert.equal(snap.error?.message, 'Upstream unavailable')
  assert.equal(snap.refreshing, false)
  assert.deepEqual(errors, [{ message: 'Upstream unavailable', info: { mode: 'refresh', failures: 0, retained: true } }])
  ctrl.dispose()
})

test('polling skips hidden tabs, prevents overlaps, backs off on failures, and triggers one read on overdue return', async () => {
  const fake = createFakeEnv()
  let calls = 0
  let shouldFail = false
  let pending: Deferred<number> | null = null

  const ctrl = createLiveDataController<number>(
    {
      key: 'ops',
      fetcher: () => {
        calls += 1
        if (shouldFail) return Promise.reject(new Error('boom'))
        if (pending) return pending.promise
        return Promise.resolve(calls)
      },
      intervalMs: 10_000,
      maxBackoffMs: 40_000,
      enabled: true,
    },
    fake.env,
  )

  ctrl.start()
  await flush()
  assert.equal(calls, 1)
  assert.deepEqual(fake.pendingTimers(), [10_000])

  // Hide the tab: timer cleared, advancing far past interval triggers 0 reads.
  await fake.setHidden(true)
  assert.deepEqual(fake.pendingTimers(), [])
  await fake.advance(60_000)
  assert.equal(calls, 1, 'no reads while hidden')

  // Return to the now-overdue tab: schedules 0ms -> exactly ONE read.
  await fake.setHidden(false)
  assert.deepEqual(fake.pendingTimers(), [0])
  await fake.advance(0)
  assert.equal(calls, 2, 'overdue return triggers one read')
  assert.equal(ctrl.getSnapshot().data, 2)
  assert.deepEqual(fake.pendingTimers(), [10_000])

  // Consecutive auto-refresh failures double the backoff (10s -> 20s -> 40s) and retain data.
  shouldFail = true
  await fake.advance(10_000)
  assert.equal(calls, 3)
  assert.equal(ctrl.getSnapshot().data, 2, 'retains last data')
  assert.equal(ctrl.getSnapshot().error?.message, 'boom')
  assert.deepEqual(fake.pendingTimers(), [20_000])

  await fake.advance(20_000)
  assert.equal(calls, 4)
  assert.deepEqual(fake.pendingTimers(), [40_000])

  // Recovery resets backoff to base 10s.
  shouldFail = false
  await fake.advance(40_000)
  assert.equal(calls, 5)
  assert.equal(ctrl.getSnapshot().data, 5)
  assert.equal(ctrl.getSnapshot().error, null)
  assert.deepEqual(fake.pendingTimers(), [10_000])

  // Non-overlapping protection: if a refresh is already in flight when the tick fires, skip auto-read.
  pending = deferred<number>()
  const manual = ctrl.refresh()
  assert.equal(calls, 6)
  await fake.advance(10_000)
  assert.equal(calls, 6, 'auto tick does not overlap in-flight manual refresh')
  pending.resolve(99)
  pending = null
  await manual
  assert.equal(ctrl.getSnapshot().data, 99)

  ctrl.dispose()
  assert.equal(fake.visibilityListenerCount(), 0, 'visibility listener cleaned up on dispose')
  assert.deepEqual(fake.pendingTimers(), [], 'timer cleaned up on dispose')
})

test('dynamic intervalMs from server payload and setData update polling and clear errors', async () => {
  const fake = createFakeEnv()
  const ctrl = createLiveDataController<{ value: string; refreshEvery: number }>(
    {
      key: 'blocks',
      fetcher: async () => ({ value: 'a', refreshEvery: 15 }),
      intervalMs: (d) => (d?.refreshEvery ?? 0) * 1000,
      maxBackoffMs: DEFAULT_MAX_BACKOFF_MS,
      enabled: true,
    },
    fake.env,
  )

  ctrl.start()
  assert.deepEqual(fake.pendingTimers(), [], 'no polling before payload sets refreshEvery')
  await flush()
  assert.deepEqual(fake.pendingTimers(), [15_000], 'polling starts once data reports refreshEvery')

  ctrl.setData({ value: 'from-action', refreshEvery: 30 })
  assert.deepEqual(ctrl.getSnapshot().data, { value: 'from-action', refreshEvery: 30 })
  assert.deepEqual(fake.pendingTimers(), [30_000], 'setData updates dynamic polling interval')
  ctrl.dispose()
})

test('useLiveData renders safely during SSR without throwing', () => {
  function Probe() {
    const { loading, data } = useLiveData('ssr-key', async () => 'ok')
    return createElement('span', null, loading ? 'loading' : String(data))
  }
  assert.equal(renderToStaticMarkup(createElement(Probe)), '<span>loading</span>')
})
