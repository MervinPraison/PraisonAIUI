/** Logs page data, pure (logs.test.ts): GET /api/logs lines → LogViewer entries. */
import type { LogEntry } from '@/components/page/LogViewer'

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** `{ logs: [{ timestamp, level, logger, message }] }` → entries (oldest first). */
export function logEntries(body: unknown): LogEntry[] {
  const list = body && typeof body === 'object' ? (body as { logs?: unknown }).logs : null
  if (!Array.isArray(list)) return []
  return list.flatMap((raw, i) => {
    if (!raw || typeof raw !== 'object') return []
    const l = raw as Record<string, unknown>
    const ts = typeof l.timestamp === 'number' ? l.timestamp : str(l.timestamp ?? l.time ?? l.ts)
    return [{ id: `${i}:${str(ts)}`, ts, level: str(l.level) || 'info', source: str(l.logger ?? l.source) || undefined, message: str(l.message) }]
  })
}

/** One line per entry: "time LEVEL source message". */
export function logsAsText(entries: readonly LogEntry[]): string {
  return entries.map((e) => [e.ts, e.level.toUpperCase(), e.source ?? '', e.message].filter((p) => p !== '').join(' ')).join('\n') + '\n'
}
