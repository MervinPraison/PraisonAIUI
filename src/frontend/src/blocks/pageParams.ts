/**
 * Page parameters for server pages (docs/guides/server-pages.md).
 *
 * A page's URL query string (`/sales?region=eu&tag=a&tag=b`) is its state:
 * BlockPage forwards it to the data request, a `method: "get"` form writes its
 * values into it, and an action reply's `_params` does the same, so a refresh,
 * a bookmark or a shared link restores the view. Writes use replaceState.
 */

/** `endpoint` with the query of `search` appended (keeps any query it has). */
export function withQuery(endpoint: string, search: string): string {
  const q = search.replace(/^\?/, '')
  if (!q) return endpoint
  return `${endpoint}${endpoint.includes('?') ? '&' : '?'}${q}`
}

function asText(v: unknown): string | null {
  if (v === null || v === undefined || v === false || v === '') return null
  if (v === true) return 'true'
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return null
}

/**
 * `search` with `values` merged in: each key is replaced; a list sets the key
 * once per item; null, '', false or an empty list removes it. Keys not in
 * `values` (e.g. `layout`) stay. Returns the new search string ('' or '?…').
 */
export function mergeSearch(search: string, values: Record<string, unknown>): string {
  const q = new URLSearchParams(search)
  for (const [key, value] of Object.entries(values)) {
    if (!key || key.startsWith('_')) continue
    q.delete(key)
    for (const item of Array.isArray(value) ? value : [value]) {
      const text = asText(item)
      if (text !== null) q.append(key, text)
    }
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

/** Write `values` into the current URL's query string (replaceState). */
export function writeParams(values: Record<string, unknown>): void {
  const { location, history } = window
  const search = mergeSearch(location.search, values)
  if (search === location.search) return
  history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`)
}

/** Shortest auto refresh period the client accepts, in seconds. */
export const MIN_REFRESH_SECONDS = 1
/** Longest back-off after repeated failures, in ms. */
export const MAX_BACKOFF_MS = 5 * 60_000

/** `_refresh_every` from a payload → seconds, or 0 when absent/invalid. */
export function refreshSeconds(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.max(MIN_REFRESH_SECONDS, n) : 0
}

/** Delay before the next auto refresh: doubles per consecutive failure, capped. */
export function nextRefreshDelay(seconds: number, failures: number): number {
  const base = Math.max(MIN_REFRESH_SECONDS, seconds) * 1000
  if (failures <= 0) return base
  return Math.min(Math.max(MAX_BACKOFF_MS, base), base * 2 ** Math.min(failures, 16))
}
