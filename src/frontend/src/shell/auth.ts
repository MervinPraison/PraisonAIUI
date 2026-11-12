/**
 * Gateway-token fetch wrapper, ported from dashboard.js getStoredToken /
 * installAuthFetch (same sessionStorage key), so the shell's own requests
 * (/api/shell/manifest, plugin modules, page APIs) authenticate after the
 * token was entered once, in the shell or in the legacy onboarding.
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

/** Wrap window.fetch to add `Authorization: Bearer <token>` to same-origin requests. */
export function installAuthFetch(): void {
  const w = window as Window & { [INSTALLED]?: true }
  if (w[INSTALLED] || typeof w.fetch !== 'function') return
  w[INSTALLED] = true
  const nativeFetch = w.fetch.bind(w)

  w.fetch = function aiuiAuthFetch(input: RequestInfo | URL, init?: RequestInit) {
    const token = getStoredToken()
    if (!token || !isSameOrigin(requestUrl(input))) return nativeFetch(input, init)

    const opts: RequestInit = { ...(init || {}) }
    const headers = new Headers(
      opts.headers || (input instanceof Request ? input.headers : undefined) || undefined,
    )
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
    opts.headers = headers
    if (!opts.credentials) opts.credentials = 'same-origin'
    return nativeFetch(input, opts)
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
