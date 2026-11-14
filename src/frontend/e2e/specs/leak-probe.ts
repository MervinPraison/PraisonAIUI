/**
 * Leak probe: counts the long-lived resources a page view can leave behind.
 *
 * `installLeakProbe` runs in the page before any app code (addInitScript) and
 * wraps WebSocket, EventSource, setInterval and window.addEventListener. A
 * snapshot taken on a neutral page before and after visiting a view shows
 * what the view did not clean up.
 */
import type { Page } from '@playwright/test'

export interface LeakSnapshot {
  /** Open WebSockets. */
  ws: number
  /** Open EventSources. */
  es: number
  /** Active setInterval timers. */
  intervals: number
  /** Listeners on window (added minus removed). */
  windowListeners: number
  /** Direct children of <body> (portals, overlays, injected nodes). */
  bodyChildren: number
}

export type LeakDelta = Partial<Record<keyof LeakSnapshot, number>>

interface ProbeWindow {
  __aiuiLeakProbe?: { snapshot(): LeakSnapshot; detail(): Record<string, unknown> }
}

/** Runs in the browser. Must stay self-contained (it is serialised). */
export function installLeakProbe(): void {
  const w = window as unknown as Window & ProbeWindow
  if (w.__aiuiLeakProbe) return
  const sockets = new Set<WebSocket>()
  const sources = new Set<EventSource>()
  const intervals = new Map<number, string>()
  const listeners = new Map<string, number>()

  const NativeWebSocket = window.WebSocket
  window.WebSocket = class extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols)
      sockets.add(this)
      this.addEventListener('close', () => sockets.delete(this))
    }
  }

  const NativeEventSource = window.EventSource
  if (NativeEventSource) {
    window.EventSource = class extends NativeEventSource {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init)
        sources.add(this)
      }
      close() {
        sources.delete(this)
        super.close()
      }
    }
  }

  const nativeSetInterval = window.setInterval.bind(window)
  const nativeClearInterval = window.clearInterval.bind(window)
  window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const id = nativeSetInterval(handler, timeout, ...args)
    intervals.set(id, (new Error().stack || '').split('\n').slice(2, 5).join(' | '))
    return id
  }) as typeof window.setInterval
  window.clearInterval = ((id?: number) => {
    if (id !== undefined) intervals.delete(id)
    return nativeClearInterval(id)
  }) as typeof window.clearInterval

  // Listener identity is (type, callback, capture), as in the DOM: adding the
  // same triple twice registers once.
  const registered = new Map<string, Map<unknown, Set<boolean>>>()
  const captureOf = (options?: boolean | AddEventListenerOptions | EventListenerOptions) =>
    typeof options === 'boolean' ? options : !!options?.capture
  const nativeAdd = window.addEventListener.bind(window)
  const nativeRemove = window.removeEventListener.bind(window)
  window.addEventListener = ((type: string, callback: unknown, options?: boolean | AddEventListenerOptions) => {
    if (callback) {
      const byCallback = registered.get(type) ?? new Map<unknown, Set<boolean>>()
      registered.set(type, byCallback)
      const captures = byCallback.get(callback) ?? new Set<boolean>()
      byCallback.set(callback, captures)
      const capture = captureOf(options)
      if (!captures.has(capture)) {
        captures.add(capture)
        listeners.set(type, (listeners.get(type) ?? 0) + 1)
        const forget = () => {
          if (captures.delete(capture)) listeners.set(type, (listeners.get(type) ?? 1) - 1)
        }
        if (typeof options === 'object' && options) {
          // `once` listeners remove themselves; `signal` removes on abort.
          if (options.once) nativeAdd(type, forget, { once: true, capture })
          options.signal?.addEventListener('abort', forget, { once: true })
        }
      }
    }
    return nativeAdd(type, callback as EventListener, options)
  }) as typeof window.addEventListener
  window.removeEventListener = ((type: string, callback: unknown, options?: boolean | EventListenerOptions) => {
    const captures = registered.get(type)?.get(callback)
    if (captures?.delete(captureOf(options))) listeners.set(type, (listeners.get(type) ?? 1) - 1)
    return nativeRemove(type, callback as EventListener, options)
  }) as typeof window.removeEventListener

  w.__aiuiLeakProbe = {
    snapshot: () => ({
      ws: [...sockets].filter((s) => s.readyState !== NativeWebSocket.CLOSED).length,
      es: sources.size,
      intervals: intervals.size,
      windowListeners: [...listeners.values()].reduce((sum, n) => sum + n, 0),
      bodyChildren: document.body.children.length,
    }),
    detail: () => ({
      ws: [...sockets].map((s) => s.url),
      es: [...sources].map((s) => s.url),
      intervals: [...intervals.values()],
      windowListeners: Object.fromEntries([...listeners].filter(([, n]) => n !== 0)),
      bodyChildren: [...document.body.children].map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${el.className}`),
    }),
  }
}

export async function leakSnapshot(page: Page): Promise<LeakSnapshot> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__aiuiLeakProbe!.snapshot())
}

export async function leakDetail(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__aiuiLeakProbe!.detail())
}

/** Non-zero differences between two snapshots. */
export function leakDelta(before: LeakSnapshot, after: LeakSnapshot): LeakDelta {
  const delta: LeakDelta = {}
  for (const key of Object.keys(before) as (keyof LeakSnapshot)[]) {
    if (after[key] !== before[key]) delta[key] = after[key] - before[key]
  }
  return delta
}
