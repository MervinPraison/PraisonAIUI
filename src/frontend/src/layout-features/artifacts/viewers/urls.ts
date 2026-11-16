/**
 * The chat's media URL policy (chat-engine/util: safeUrl, isTrustedImageUrl,
 * hostOf), for the viewers. Kept here rather than imported: importing that
 * module would split it out of the chat route's chunk (the canvas loads
 * from the layout descriptor, not from the chat page), which costs the chat
 * route budget. urls.test.ts checks both give the same answers.
 */

/** http(s), blob:, data:image/ or a relative path; anything else (javascript:, data:text/html) is undefined. */
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

/** Same-origin, data:image and blob: load on their own; anything else waits for a click. */
export function isTrustedUrl(url: string): boolean {
  if (/^(data:image\/|blob:)/i.test(url)) return true
  try {
    const origin = globalThis.location?.origin
    if (!origin) return false
    return new URL(url, origin).origin === origin
  } catch {
    return false
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url, globalThis.location?.href).host || url
  } catch {
    return url
  }
}
