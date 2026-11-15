/**
 * The words the canvas, the cards and the page show about an artifact, and
 * what Copy and Download hand over. Pure (no React, no DOM).
 */
import { LANG_EXT, languageName, parseTable, plainText, tableToCsv, type DerivedArtifact } from './derive'

const KIND_NAMES: Record<string, string> = {
  table: 'Table', markdown: 'Document', file: 'File', image: 'Image', pdf: 'PDF', video: 'Video', a2ui: 'Interactive view',
}

/** DOM ids of the canvas tabs and their panel. */
export const tabId = (key: string) => `aiui-art-tab-${key.replace(/[^A-Za-z0-9_-]/g, '_')}`
export const PANEL_ID = 'aiui-art-panel'

const plural =(n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** `Table · 3 rows`, `Python · 5 lines`, `Image`. */
export function kindLine(a: DerivedArtifact): string {
  // An index row from the server has no text, so no counts.
  const known = a.content !== undefined
  if (a.kind === 'table') {
    const rows = a.rows ?? (known ? parseTable(a.content ?? '').rows.length : undefined)
    return rows === undefined ? 'Table' : `Table · ${plural(rows, 'row')}`
  }
  if (a.kind === 'code' || a.kind === 'markdown') {
    const name = a.kind === 'code' ? languageName(a.language) : 'Document'
    const lines = a.lines ?? (known ? lineCount(a.content) : undefined)
    return lines === undefined ? name : `${name} · ${plural(lines, 'line')}`
  }
  return KIND_NAMES[a.kind] ?? 'File'
}

/** The card's meta line: `Table · 3 rows · v2 · edited by Researcher`, `Python · 5 lines · runnable`. */
export function cardMeta(a: DerivedArtifact, opts: { runnable?: boolean; compact?: boolean } = {}): string {
  const parts = [kindLine(a)]
  if (a.version > 1) parts.push(`v${a.version}`)
  if (opts.runnable) parts.push('runnable')
  if (!opts.compact && a.version > 1) parts.push(a.edited ? 'edited by you' : a.agent ? `edited by ${a.agent}` : 'edited')
  return parts.join(' · ')
}

export function lineCount(text: string | undefined): number {
  return text ? text.split('\n').length : 0
}

const pad = (n: number) => String(n).padStart(2, '0')

/** `10:42`, local time. */
export function clockTime(ms: number | undefined): string {
  if (!ms) return ''
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `just now`, `2 min ago`, `3 h ago`, `yesterday`, `4 days ago`. */
export function relativeTime(ms: number | undefined, now = Date.now()): string {
  if (!ms) return ''
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

/** One line per version for History: `Researcher created the table`, `Researcher added the Stable column`. */
export function describeVersion(cur: DerivedArtifact, prev: DerivedArtifact | undefined): string {
  if (cur.edited) return cur.restoredFrom ? `You restored v${cur.restoredFrom}` : 'You edited it'
  const who = cur.agent ?? 'The agent'
  const noun = cur.kind === 'table' ? 'the table' : cur.kind === 'code' ? 'the file' : cur.kind === 'a2ui' ? 'the view' : `the ${(KIND_NAMES[cur.kind] ?? 'file').toLowerCase()}`
  if (!prev) return `${who} created ${noun}`
  if (cur.kind === 'table') {
    const before = new Set((prev.columns ?? []).map((c) => c.toLowerCase()))
    const after = new Set((cur.columns ?? []).map((c) => c.toLowerCase()))
    const added = (cur.columns ?? []).filter((c) => !before.has(c.toLowerCase()))
    const removed = (prev.columns ?? []).filter((c) => !after.has(c.toLowerCase()))
    const list = (cols: string[]) => (cols.length === 1 ? `the ${cols[0]} column` : `${cols.length} columns`)
    if (added.length && !removed.length) return `${who} added ${list(added)}`
    if (removed.length && !added.length) return `${who} removed ${list(removed)}`
    if ((cur.rows ?? 0) !== (prev.rows ?? 0)) return `${who} changed it to ${plural(cur.rows ?? 0, 'row')}`
    return `${who} updated the rows`
  }
  if (cur.kind === 'code' || cur.kind === 'markdown') {
    const { added, removed } = lineDiff(prev.content ?? '', cur.content ?? '')
    if (added || removed) return `${who} changed ${noun} (+${added} −${removed})`
  }
  return `${who} updated ${noun}`
}

/** Lines added and removed, by multiset (good enough for a summary, not a diff). */
export function lineDiff(a: string, b: string): { added: number; removed: number } {
  const count = new Map<string, number>()
  for (const l of a.split('\n')) count.set(l, (count.get(l) ?? 0) + 1)
  let added = 0
  for (const l of b.split('\n')) {
    const n = count.get(l) ?? 0
    if (n > 0) count.set(l, n - 1)
    else added++
  }
  let removed = 0
  for (const n of count.values()) removed += n
  return { added, removed }
}

const slug = (s: string) =>
  plainText(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'artifact'

/** What Download saves: a file name, a MIME type and the text (or, for media, the URL to fetch). */
export function downloadOf(a: DerivedArtifact): { filename: string; mime: string; text?: string; url?: string } {
  const named = !/^(table|code|markdown|a2ui|url|file):/.test(a.key) ? a.key.split('/').pop() : undefined
  switch (a.kind) {
    case 'table':
      return { filename: `${slug(a.title)}.csv`, mime: 'text/csv', text: tableToCsv(a.content ?? '') }
    case 'code':
      return { filename: named ?? `${slug(a.title)}.${LANG_EXT[a.language ?? ''] ?? 'txt'}`, mime: 'text/plain', text: a.content ?? '' }
    case 'markdown':
      return { filename: named ?? `${slug(a.title)}.md`, mime: 'text/markdown', text: a.content ?? '' }
    case 'a2ui':
      return { filename: `${slug(a.title)}.json`, mime: 'application/json', text: a.content ?? '[]' }
    default:
      return { filename: a.key.startsWith('file:') ? a.key.slice(5) : a.title, mime: a.mimeType ?? 'application/octet-stream', url: a.url }
  }
}

/** What Copy puts on the clipboard: the text (a table as markdown), else the URL. */
export function copyText(a: DerivedArtifact): string {
  return a.content ?? a.url ?? ''
}

/**
 * The share link: the artifacts page opened on this artifact. It works for
 * anyone who can open the chat itself (the page reads the session).
 */
export function shareUrl(a: Pick<DerivedArtifact, 'sessionId' | 'key' | 'version'>, origin: string): string {
  const q = new URLSearchParams({ session: a.sessionId ?? '', artifact: a.key, v: String(a.version) })
  return `${origin}/artifacts?${q.toString()}`
}

/** `{session, artifact, v}` from a share link's query string. */
export function parseShareQuery(search: string): { sessionId: string; key: string; version?: number } | null {
  const q = new URLSearchParams(search)
  const sessionId = q.get('session')
  const key = q.get('artifact')
  if (!sessionId || !key) return null
  const v = Number(q.get('v'))
  return { sessionId, key, version: Number.isInteger(v) && v > 0 ? v : undefined }
}
