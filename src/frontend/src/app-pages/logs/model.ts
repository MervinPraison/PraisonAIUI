/** Logs page data, pure (logs.test.ts): GET /api/logs lines → LogViewer entries. */
import type { LogEntry } from '@/components/page/LogViewer'

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

/**
 * The message without the "<logger> - " the server's log format puts in
 * front: the source column already names the logger, and on a phone the
 * repeated dotted name was what broke mid-word.
 */
function withoutSource(message: string, source: string): string {
  const prefix = `${source} - `
  return source && message.startsWith(prefix) ? message.slice(prefix.length) : message
}

/** `{ logs: [{ timestamp, level, logger, message }] }` → entries (oldest first). */
export function logEntries(body: unknown): LogEntry[] {
  const list = body && typeof body === 'object' ? (body as { logs?: unknown }).logs : null
  if (!Array.isArray(list)) return []
  return list.flatMap((raw, i) => {
    if (!raw || typeof raw !== 'object') return []
    const l = raw as Record<string, unknown>
    const ts = typeof l.timestamp === 'number' ? l.timestamp : str(l.timestamp ?? l.time ?? l.ts)
    const source = str(l.logger ?? l.source)
    return [{ id: `${i}:${str(ts)}`, ts, level: str(l.level) || 'info', source: source || undefined, message: withoutSource(str(l.message), source) }]
  })
}

/** One line per entry: "time LEVEL source message". */
export function logsAsText(entries: readonly LogEntry[]): string {
  return entries.map((e) => [e.ts, e.level.toUpperCase(), e.source ?? '', e.message].filter((p) => p !== '').join(' ')).join('\n') + '\n'
}
