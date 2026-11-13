/** Pure helpers shared by the chat UI (kept out of .tsx so Fast Refresh stays happy). */

/** Same-origin, data:image and blob: images load automatically; anything else waits for a click. */
export function isTrustedImageUrl(url: string): boolean {
  if (/^(data:image\/|blob:)/i.test(url)) return true
  try {
    const origin = globalThis.location?.origin
    if (!origin) return false
    return new URL(url, origin).origin === origin
  } catch {
    return false
  }
}

/**
 * A URL that is safe to put in href/src: http(s), blob:, data:image/, or a
 * relative path. `javascript:`, `data:text/html`, `vbscript:` and the like
 * return undefined (an element or reference URL comes from tool output, which
 * a prompt injection can control).
 */
export function safeUrl(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url.trim()) return undefined
  const u = url.trim()
  if (/^data:image\//i.test(u)) return u
  try {
    const parsed = new URL(u, globalThis.location?.href ?? 'http://localhost/')
    return ['http:', 'https:', 'blob:'].includes(parsed.protocol) ? u : undefined
  } catch {
    return undefined
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url, globalThis.location?.href).host || url
  } catch {
    return url
  }
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.max(1, Math.round(ms / 100)) / 10}s`
  const s = ms / 1000
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${Math.round(s % 60)}s`
}
