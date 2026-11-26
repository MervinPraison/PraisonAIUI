/**
 * Lazy-loaded server notification source (`GET /api/notifications` + SSE
 * `/api/notifications/stream` + optimistic REST reconciliation).
 *
 * Kept in its own module so `builtin/notifications.ts` loads it asynchronously
 * after activation rather than pulling REST/SSE parsing onto the boot path (R10).
 */
import type { BuiltinSdk } from './types'
import type { NotificationSource, PushNotificationInput } from '@/sdk/notifications'

const LIST_URL = '/api/notifications'
const STREAM_URL = '/api/notifications/stream'

export function asPushInput(raw: unknown): PushNotificationInput | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const title = typeof r.title === 'string' ? r.title : typeof r.message === 'string' ? r.message : ''
  if (!title.trim()) return null
  return {
    id: typeof r.id === 'string' ? r.id : undefined,
    title,
    description: typeof r.description === 'string' ? r.description : undefined,
    type: typeof r.type === 'string' ? (r.type as PushNotificationInput['type']) : undefined,
    category: typeof r.category === 'string' ? r.category : undefined,
    source: typeof r.source === 'string' ? r.source : undefined,
    createdAt:
      typeof r.createdAt === 'number'
        ? r.createdAt
        : typeof r.created_at === 'number'
          ? r.created_at
          : undefined,
    read: typeof r.read === 'boolean' ? r.read : undefined,
    pinned: typeof r.pinned === 'boolean' ? r.pinned : undefined,
    dedupeKey:
      typeof r.dedupeKey === 'string'
        ? r.dedupeKey
        : typeof r.dedupe_key === 'string'
          ? r.dedupe_key
          : undefined,
    action: r.action && typeof r.action === 'object' ? (r.action as PushNotificationInput['action']) : undefined,
    meta: r.meta && typeof r.meta === 'object' ? (r.meta as Record<string, unknown>) : undefined,
    toast: r.toast === true,
  }
}

export interface ServerNotificationSourceOptions {
  EventSource?: typeof EventSource
  pollMs?: number
}

export function createServerNotificationSource(
  sdk: Pick<BuiltinSdk, 'fetchJson'>,
  { EventSource: ES = globalThis.EventSource, pollMs = 30_000 }: ServerNotificationSourceOptions = {},
): NotificationSource {
  let active = false
  let disabled = false

  const isUnavailable = (err: unknown): boolean => {
    const status = (err as { status?: number } | null)?.status
    return status === 404 || status === 401 || status === 403
  }

  return {
    connect(ctx) {
      active = true
      disabled = false
      let es: EventSource | null = null
      let pollTimer: ReturnType<typeof setInterval> | null = null

      const stopStreamAndPoll = () => {
        if (es) {
          es.close()
          es = null
        }
        if (pollTimer) {
          clearInterval(pollTimer)
          pollTimer = null
        }
      }

      const refresh = (): Promise<boolean> => {
        if (!active || disabled) return Promise.resolve(false)
        return sdk
          .fetchJson<{ notifications?: unknown[] }>(LIST_URL)
          .then((body) => {
            if (!active) return false
            const list = Array.isArray(body?.notifications)
              ? body.notifications.map(asPushInput).filter((x): x is PushNotificationInput => x !== null)
              : []
            ctx.sync(list, { source: 'server', replaceSource: true })
            return true
          })
          .catch((err: unknown) => {
            if (isUnavailable(err)) {
              disabled = true
              stopStreamAndPoll()
            }
            return false
          })
      }

      const startPolling = () => {
        if (!active || disabled || pollTimer || pollMs <= 0) return
        pollTimer = setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          void refresh()
        }, pollMs)
      }

      const openStream = () => {
        if (!active || disabled || typeof ES !== 'function') {
          startPolling()
          return
        }
        try {
          const stream = new ES(STREAM_URL)
          es = stream
          stream.addEventListener('notification', (ev: Event) => {
            try {
              const item = asPushInput(JSON.parse((ev as MessageEvent).data))
              if (item) ctx.push({ ...item, source: item.source ?? 'server' })
            } catch {
              /* ignore malformed frame */
            }
          })
          stream.addEventListener('read', (ev: Event) => {
            try {
              const data = JSON.parse((ev as MessageEvent).data) as { id?: string }
              if (data.id) ctx.markRead(data.id, { localOnly: true })
            } catch {
              /* ignore */
            }
          })
          stream.addEventListener('read_all', () => {
            ctx.markAllRead({ localOnly: true })
          })
          stream.addEventListener('removed', (ev: Event) => {
            try {
              const data = JSON.parse((ev as MessageEvent).data) as { id?: string }
              if (data.id) ctx.remove(data.id, { localOnly: true })
            } catch {
              /* ignore */
            }
          })
          stream.addEventListener('cleared', (ev: Event) => {
            try {
              const data = JSON.parse((ev as MessageEvent).data) as { include_pinned?: boolean; read_only?: boolean }
              ctx.clear({
                includePinned: Boolean(data.include_pinned),
                readOnly: Boolean(data.read_only),
                localOnly: true,
              })
            } catch {
              ctx.clear({ localOnly: true })
            }
          })
          stream.onerror = () => {
            stream.close()
            if (es === stream) es = null
            startPolling()
          }
        } catch {
          startPolling()
        }
      }

      void refresh().then((ok) => {
        if (ok && active && !disabled) openStream()
      })

      return () => {
        active = false
        stopStreamAndPoll()
      }
    },

    onMarkRead(id, item) {
      if (disabled || item.source !== 'server') return
      void sdk.fetchJson(`${LIST_URL}/${encodeURIComponent(id)}/read`, { method: 'POST' }).catch(() => undefined)
    },

    onMarkAllRead() {
      if (disabled) return
      void sdk.fetchJson(`${LIST_URL}/read-all`, { method: 'POST' }).catch(() => undefined)
    },

    onRemove(id, item) {
      if (disabled || item.source !== 'server') return
      void sdk.fetchJson(`${LIST_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined)
    },

    onClear(opts) {
      if (disabled) return
      const params = new URLSearchParams()
      if (opts.includePinned) params.set('include_pinned', 'true')
      if (opts.readOnly) params.set('read_only', 'true')
      const qs = params.toString()
      void sdk.fetchJson(`${LIST_URL}${qs ? `?${qs}` : ''}`, { method: 'DELETE' }).catch(() => undefined)
    },
  }
}
