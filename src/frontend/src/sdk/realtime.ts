/**
 * Authenticated WebSocket helpers for `@aiui/sdk` and `chat-engine`.
 *
 * Browsers cannot attach `Authorization: Bearer` headers to a WebSocket
 * handshake, so PraisonAIUI exchanges the stored session token (or session
 * cookie) for a single-use 60 s ticket via `POST /api/auth/ws-ticket` and
 * passes `?ticket=` on the same-origin handshake URL.
 */

/** Same key as dashboard.js ONBOARD_TOKEN_KEY and the shell's auth fetch. */
export const TOKEN_STORAGE_KEY = 'aiui_gateway_token'

export const WS_TICKET_URL = '/api/auth/ws-ticket'

export interface OpenWebSocketOptions {
  /** Optional WebSocket subprotocol(s) passed to `new WebSocket(url, protocols)`. */
  protocols?: string | string[]
  /** Optional custom `fetch` implementation (tests). */
  fetchImpl?: typeof fetch
  /** Optional custom `WebSocket` constructor (tests). */
  WebSocketImpl?: new (url: string, protocols?: string | string[]) => WebSocket
}

function storedToken(): string {
  try {
    return globalThis.sessionStorage?.getItem(TOKEN_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

/**
 * Exchange the active session's credentials for a single-use 60 s WebSocket
 * ticket (`POST /api/auth/ws-ticket`). Returns `null` when the server does not
 * expose the ticket endpoint or refuses the request.
 */
export async function getWsTicket(fetchImpl: typeof fetch = globalThis.fetch): Promise<string | null> {
  const token = storedToken()
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const res = await fetchImpl(WS_TICKET_URL, {
      method: 'POST',
      headers,
      credentials: 'same-origin',
    })
    if (!res.ok) return null
    const data = (await res.json()) as { ticket?: unknown }
    return typeof data.ticket === 'string' && data.ticket ? data.ticket : null
  } catch {
    return null
  }
}

/**
 * The query string that authenticates one WebSocket handshake: a single-use
 * ticket bought with the stored token, `?token=` on servers without the ticket
 * endpoint, nothing when no token is stored (cookie or open servers).
 */
export async function wsAuthQuery(fetchImpl: typeof fetch = globalThis.fetch): Promise<string> {
  const token = storedToken()
  if (!token) return ''
  try {
    const res = await fetchImpl(WS_TICKET_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'same-origin',
    })
    if (res.ok) {
      const data = (await res.json()) as { ticket?: unknown }
      if (typeof data.ticket === 'string' && data.ticket) return `?ticket=${encodeURIComponent(data.ticket)}`
    } else if (res.status !== 404 && res.status !== 405) {
      return '' // the token was refused: the handshake fails the same way
    }
  } catch {
    /* network trouble: the handshake will fail and retry */
  }
  return `?token=${encodeURIComponent(token)}`
}

function resolveWsTarget(path: string): { url: string; sameOrigin: boolean } {
  const loc = globalThis.location
  const defaultScheme = loc?.protocol === 'https:' ? 'wss:' : 'ws:'
  const defaultHost = loc?.host || '127.0.0.1'

  if (/^wss?:\/\//i.test(path)) {
    try {
      const parsed = new URL(path)
      const sameOrigin = Boolean(loc?.host) && parsed.host === loc.host && parsed.protocol === defaultScheme
      return { url: parsed.toString(), sameOrigin }
    } catch {
      return { url: path, sameOrigin: false }
    }
  }

  const normalized = path.startsWith('/') ? path : `/${path}`
  return { url: `${defaultScheme}//${defaultHost}${normalized}`, sameOrigin: true }
}

function appendQuery(url: string, query: string): string {
  if (!query) return url
  const raw = query.startsWith('?') ? query.slice(1) : query
  return `${url}${url.includes('?') ? '&' : '?'}${raw}`
}

/**
 * Open an authenticated WebSocket to a same-origin path (e.g.
 * `'/api/plugins/my-plugin/ws/events'`). Exchanges any stored gateway token for
 * a single-use ticket before opening; never attaches credentials to a
 * cross-origin WebSocket URL.
 */
export async function openWebSocket(path: string, options: OpenWebSocketOptions = {}): Promise<WebSocket> {
  const { url, sameOrigin } = resolveWsTarget(path)
  const auth = sameOrigin ? await wsAuthQuery(options.fetchImpl) : ''
  const target = appendQuery(url, auth)
  const Ctor = options.WebSocketImpl ?? globalThis.WebSocket
  return options.protocols !== undefined ? new Ctor(target, options.protocols) : new Ctor(target)
}
