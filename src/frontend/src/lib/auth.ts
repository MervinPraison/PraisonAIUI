/**
 * Gateway-token fetch wrapper, ported from dashboard.js getStoredToken /
 * installAuthFetch (same sessionStorage key), so same-origin requests
 * authenticate after the token was entered once, in the shell, the legacy
 * onboarding or the legacy React App's sign-in prompt. The app shell
 * (shell/mount) and the legacy React App (legacy-app-entry: docs pages,
 * manifests, search index) both install it.
 *
 * Idempotent. When the legacy runtime later wraps fetch again, its wrapper
 * sees our Authorization header and leaves it alone (and vice versa).
 */

/** Same key as dashboard.js ONBOARD_TOKEN_KEY. */
export const TOKEN_STORAGE_KEY = 'aiui_gateway_token'
export const AUTH_STATUS_URL = '/api/auth/status'

const INSTALLED = Symbol.for('aiui.shell.authFetch')

export function getStoredToken(): string {
  try {
    return window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function storeToken(token: string): void {
  try {
    window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
  } catch {
    /* storage blocked: the token only lives for this request */
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input?.url || ''
}

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin === window.location.origin
  } catch {
    return true // relative or opaque URLs are same-origin
  }
}

type AuthRequiredListener = (url: string) => void
const authRequiredListeners = new Set<AuthRequiredListener>()

/**
 * Call `listener` when a same-origin GET outside `/api/` answers 401: page
 * content (a docs page's markdown, the search index) the server keeps behind
 * auth. Returns the unsubscribe function.
 */
export function onAuthRequired(listener: AuthRequiredListener): () => void {
  authRequiredListeners.add(listener)
  return () => {
    authRequiredListeners.delete(listener)
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method || (input instanceof Request ? input.method : '') || 'GET').toUpperCase()
}

function isContentPath(url: string): boolean {
  try {
    return !new URL(url, window.location.href).pathname.startsWith('/api/')
  } catch {
    return false
  }
}

/** Wrap window.fetch to add `Authorization: Bearer <token>` to same-origin requests. */
export function installAuthFetch(): void {
  const w = window as Window & { [INSTALLED]?: true }
  if (w[INSTALLED] || typeof w.fetch !== 'function') return
  w[INSTALLED] = true
  const nativeFetch = w.fetch.bind(w)

  w.fetch = function aiuiAuthFetch(input: RequestInfo | URL, init?: RequestInit) {
    const url = requestUrl(input)
    if (!isSameOrigin(url)) return nativeFetch(input, init)
    const token = getStoredToken()
    let pending: Promise<Response>
    if (!token) {
      pending = nativeFetch(input, init)
    } else {
      const opts: RequestInit = { ...(init || {}) }
      const headers = new Headers(
        opts.headers || (input instanceof Request ? input.headers : undefined) || undefined,
      )
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
      opts.headers = headers
      if (!opts.credentials) opts.credentials = 'same-origin'
      pending = nativeFetch(input, opts)
    }
    if (authRequiredListeners.size === 0) return pending
    const method = requestMethod(input, init)
    return pending.then((res) => {
      if (res.status === 401 && method === 'GET' && isContentPath(url)) {
        for (const listener of authRequiredListeners) listener(url)
      }
      return res
    })
  }
}

/**
 * Check a token against GET /api/auth/status (as the legacy onboarding does)
 * and store it when the server accepts it.
 */
export async function verifyAndStoreToken(token: string): Promise<boolean> {
  const value = token.trim()
  if (!value) return false
  try {
    const res = await fetch(AUTH_STATUS_URL, {
      headers: { Authorization: `Bearer ${value}` },
      credentials: 'same-origin',
    })
    if (!res.ok) return false
    const data = (await res.json()) as { authenticated?: boolean } | null
    if (!data?.authenticated) return false
    storeToken(value)
    return true
  } catch {
    return false
  }
}
