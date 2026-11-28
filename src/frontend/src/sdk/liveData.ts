/**
 * Shared live-data hook (`useLiveData`) for built-in BlockPage and custom React
 * plugin pages.
 *
 * Handles keyed fetching (switching keys aborts in-flight work and never shows
 * the previous key's data), retaining the last successful result on refresh
 * errors, visibility-aware polling (skips hidden tabs, triggers one read on
 * return when overdue), non-overlapping auto refreshes, and exponential retry
 * backoff.
 */
import { useCallback, useEffect, useState } from 'react'

export const MIN_LIVE_REFRESH_MS = 1_000
export const DEFAULT_MAX_BACKOFF_MS = 5 * 60_000

export type LiveDataLoadMode = 'initial' | 'refresh' | 'auto'

export interface LiveDataErrorInfo {
  readonly mode: LiveDataLoadMode
  readonly failures: number
  readonly retained: boolean
}

export interface LiveDataSuccessInfo {
  readonly mode: LiveDataLoadMode
}

export type LiveIntervalOption<T> = number | ((data: T | undefined) => number)

export interface UseLiveDataOptions<T> {
  /** Auto-refresh period in ms, or a function reading it from data (0 disables; min 1000 ms). */
  intervalMs?: LiveIntervalOption<T>
  /** Cap for exponential backoff after consecutive auto-refresh failures (default 300 000 ms). */
  maxBackoffMs?: number
  /** Set false to pause loading and auto-refresh (default true). */
  enabled?: boolean
  /** Called when a non-aborted load fails. */
  onError?: (error: Error, info: LiveDataErrorInfo) => void
  /** Called when a load succeeds. */
  onSuccess?: (data: T, info: LiveDataSuccessInfo) => void
}

export interface UseLiveDataResult<T> {
  /** Latest successful data for the current key, or undefined before first load. */
  readonly data: T | undefined
  /** Latest error for the current key, or null when healthy. */
  readonly error: Error | null
  /** True while the current key has no data yet and no error has settled. */
  readonly loading: boolean
  /** True while any request for the current key is in flight. */
  readonly refreshing: boolean
  /** Epoch ms of the last successful read (or setData) for the current key, or null. */
  readonly updatedAt: number | null
  /** Trigger a manual refresh (retains existing data for this key if it fails). */
  readonly refresh: () => Promise<void>
  /** Replace data directly (e.g. after a mutation or POST action). */
  readonly setData: (next: T) => void
}

/** Delay before the next auto-refresh: doubles per consecutive failure, capped. */
export function nextRefreshDelayMs(
  intervalMs: number,
  failures: number,
  maxBackoffMs: number = DEFAULT_MAX_BACKOFF_MS,
): number {
  const base = Math.max(MIN_LIVE_REFRESH_MS, intervalMs)
  if (failures <= 0) return base
  return Math.min(Math.max(maxBackoffMs, base), base * 2 ** Math.min(failures, 16))
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

export interface LiveDataSnapshot<T> {
  readonly key: string
  readonly data: T | undefined
  readonly hasData: boolean
  readonly error: Error | null
  readonly updatedAt: number | null
  readonly refreshing: boolean
}

export interface LiveDataEnv {
  now: () => number
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeout: (id: ReturnType<typeof setTimeout> | undefined) => void
  isHidden: () => boolean
  addVisibilityListener: (fn: () => void) => () => void
}

function defaultEnv(): LiveDataEnv {
  return {
    now: () => Date.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => {
      if (id !== undefined) globalThis.clearTimeout(id)
    },
    isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    addVisibilityListener: (fn) => {
      if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return () => {}
      document.addEventListener('visibilitychange', fn)
      return () => document.removeEventListener('visibilitychange', fn)
    },
  }
}

export interface LiveDataControllerConfig<T> {
  key: string
  fetcher: (signal: AbortSignal) => Promise<T>
  intervalMs: LiveIntervalOption<T>
  maxBackoffMs: number
  enabled: boolean
  onError?: (error: Error, info: LiveDataErrorInfo) => void
  onSuccess?: (data: T, info: LiveDataSuccessInfo) => void
}

export interface LiveDataController<T> {
  getSnapshot: () => LiveDataSnapshot<T>
  subscribe: (fn: () => void) => () => void
  updateConfig: (next: LiveDataControllerConfig<T>) => void
  start: () => void
  stop: () => void
  refresh: () => Promise<void>
  setData: (next: T) => void
  dispose: () => void
}

/** Pure, framework-agnostic controller backing `useLiveData` (also unit-testable directly). */
export function createLiveDataController<T>(
  initial: LiveDataControllerConfig<T>,
  env: LiveDataEnv = defaultEnv(),
): LiveDataController<T> {
  let cfg = { ...initial }
  let state: LiveDataSnapshot<T> = {
    key: cfg.key,
    data: undefined,
    hasData: false,
    error: null,
    updatedAt: null,
    refreshing: false,
  }
  let inflight: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let unsubVisibility: (() => void) | null = null
  let failures = 0
  let lastLoad = 0
  let gen = 0
  let activeInterval = 0
  let disposed = false
  let started = false
  const listeners = new Set<() => void>()

  const emit = (next: LiveDataSnapshot<T>) => {
    state = next
    for (const fn of [...listeners]) fn()
  }

  const clearTimer = () => {
    env.clearTimeout(timer)
    timer = undefined
  }

  const stopPolling = () => {
    clearTimer()
    unsubVisibility?.()
    unsubVisibility = null
    activeInterval = 0
  }

  const normalizedInterval = () => {
    if (!cfg.enabled) return 0
    const raw = typeof cfg.intervalMs === 'function' ? cfg.intervalMs(state.hasData ? state.data : undefined) : cfg.intervalMs
    return Number.isFinite(raw) && raw > 0 ? Math.max(MIN_LIVE_REFRESH_MS, raw) : 0
  }

  const schedule = (ms: number) => {
    clearTimer()
    if (disposed || !started || normalizedInterval() <= 0) return
    timer = env.setTimeout(() => void tick(), ms)
  }

  const load = async (mode: LiveDataLoadMode): Promise<void> => {
    if (disposed || !cfg.enabled) return
    if (mode === 'auto' && inflight) return
    inflight?.abort()
    const ac = new AbortController()
    inflight = ac
    const reqKey = cfg.key
    const reqGen = ++gen
    lastLoad = env.now()
    const sameKey = state.key === reqKey
    emit({
      key: reqKey,
      data: sameKey ? state.data : undefined,
      hasData: sameKey ? state.hasData : false,
      error: mode === 'initial' ? null : sameKey ? state.error : null,
      updatedAt: sameKey ? state.updatedAt : null,
      refreshing: true,
    })
    try {
      const data = await cfg.fetcher(ac.signal)
      if (disposed || ac.signal.aborted || reqGen !== gen || cfg.key !== reqKey) return
      failures = 0
      lastLoad = env.now()
      emit({
        key: reqKey,
        data,
        hasData: true,
        error: null,
        updatedAt: lastLoad,
        refreshing: false,
      })
      if (normalizedInterval() !== activeInterval) syncPolling()
      cfg.onSuccess?.(data, { mode })
    } catch (rawErr) {
      if (disposed || ac.signal.aborted || reqGen !== gen || cfg.key !== reqKey) return
      const err = toError(rawErr)
      if (mode === 'auto') failures += 1
      lastLoad = env.now()
      const retained = state.key === reqKey && state.hasData
      emit({
        key: reqKey,
        data: retained ? state.data : undefined,
        hasData: retained,
        error: err,
        updatedAt: retained ? state.updatedAt : null,
        refreshing: false,
      })
      cfg.onError?.(err, { mode, failures, retained })
    } finally {
      if (inflight === ac) {
        inflight = null
        if (!disposed && state.refreshing && state.key === reqKey) {
          emit({ ...state, refreshing: false })
        }
      }
    }
  }

  const tick = async () => {
    if (disposed || !started || normalizedInterval() <= 0) return
    if (env.isHidden()) return // resumed by visibilitychange
    if (!inflight) await load('auto')
    const interval = normalizedInterval()
    if (interval > 0 && !env.isHidden()) {
      schedule(nextRefreshDelayMs(interval, failures, cfg.maxBackoffMs))
    }
  }

  const syncPolling = () => {
    stopPolling()
    const interval = normalizedInterval()
    if (!started || disposed || interval <= 0) return
    activeInterval = interval
    const onVisibility = () => {
      if (env.isHidden()) {
        clearTimer()
        return
      }
      const delay = nextRefreshDelayMs(interval, failures, cfg.maxBackoffMs)
      const due = lastLoad + delay - env.now()
      schedule(Math.max(0, due))
    }
    unsubVisibility = env.addVisibilityListener(onVisibility)
    if (!env.isHidden()) {
      schedule(nextRefreshDelayMs(interval, failures, cfg.maxBackoffMs))
    }
  }

  return {
    getSnapshot: () => state,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    updateConfig: (next) => {
      const keyChanged = next.key !== cfg.key
      const enabledChanged = next.enabled !== cfg.enabled
      const pollChanged =
        next.maxBackoffMs !== cfg.maxBackoffMs ||
        enabledChanged ||
        keyChanged
      const prevInterval = activeInterval
      cfg = { ...next }
      if (!started || disposed) return
      if (keyChanged) {
        inflight?.abort()
        inflight = null
        failures = 0
        gen += 1
        emit({
          key: cfg.key,
          data: undefined,
          hasData: false,
          error: null,
          updatedAt: null,
          refreshing: false,
        })
        if (cfg.enabled) void load('initial')
        syncPolling()
      } else if (enabledChanged) {
        if (cfg.enabled) {
          if (!state.hasData) void load('initial')
        } else {
          inflight?.abort()
          inflight = null
        }
        syncPolling()
      } else if (pollChanged || normalizedInterval() !== prevInterval) {
        syncPolling()
      }
    },
    start: () => {
      if (started) return
      disposed = false
      started = true
      if (cfg.enabled) void load('initial')
      syncPolling()
    },
    stop: () => {
      started = false
      stopPolling()
      inflight?.abort()
      inflight = null
    },
    refresh: () => load('refresh'),
    setData: (next) => {
      if (disposed) return
      inflight?.abort()
      inflight = null
      gen += 1
      failures = 0
      lastLoad = env.now()
      emit({
        key: cfg.key,
        data: next,
        hasData: true,
        error: null,
        updatedAt: lastLoad,
        refreshing: false,
      })
      if (normalizedInterval() !== activeInterval) syncPolling()
    },
    dispose: () => {
      disposed = true
      started = false
      stopPolling()
      inflight?.abort()
      inflight = null
      listeners.clear()
    },
  }
}

/**
 * React hook for live-refreshing data on a page.
 *
 * Switching `key` aborts any in-flight read and immediately hides the previous
 * key's data. Failed refreshes keep the last successful data and `updatedAt`
 * visible alongside `error`. Auto-refresh (`intervalMs`) skips hidden tabs,
 * avoids overlapping reads, backs off exponentially on repeated failures, and
 * triggers one read when returning to an overdue tab.
 */
export function useLiveData<T>(
  key: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: UseLiveDataOptions<T> = {},
): UseLiveDataResult<T> {
  const intervalMs = options.intervalMs ?? 0
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS
  const enabled = options.enabled ?? true

  const [ctrl] = useState<LiveDataController<T>>(() =>
    createLiveDataController({
      key,
      fetcher,
      intervalMs,
      maxBackoffMs,
      enabled,
      onError: options.onError,
      onSuccess: options.onSuccess,
    }),
  )
  const [snap, setSnap] = useState<LiveDataSnapshot<T>>(() => ctrl.getSnapshot())

  useEffect(() => {
    const unsub = ctrl.subscribe(() => setSnap(ctrl.getSnapshot()))
    ctrl.start()
    return () => {
      unsub()
      ctrl.stop()
    }
  }, [ctrl])

  useEffect(() => {
    ctrl.updateConfig({
      key,
      fetcher,
      intervalMs,
      maxBackoffMs,
      enabled,
      onError: options.onError,
      onSuccess: options.onSuccess,
    })
  }, [ctrl, key, fetcher, intervalMs, maxBackoffMs, enabled, options.onError, options.onSuccess])

  const refresh = useCallback(() => ctrl.refresh(), [ctrl])
  const setData = useCallback((next: T) => ctrl.setData(next), [ctrl])

  const sameKey = snap.key === key
  const hasData = sameKey && snap.hasData
  const error = sameKey ? snap.error : null

  return {
    data: hasData ? snap.data : undefined,
    error,
    loading: enabled && !hasData && error === null,
    refreshing: sameKey ? snap.refreshing : enabled,
    updatedAt: hasData ? snap.updatedAt : null,
    refresh,
    setData,
  }
}
