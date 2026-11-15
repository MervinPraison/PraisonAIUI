/**
 * Sessions page data, pure (sessions.test.ts): the rows from
 * GET /api/sessions, the toolbar filters and the column sort.
 */
import type { ListSort } from '@/components/page/ListDetail'
import { toMs } from '../shared'

export interface SessionRow {
  id: string
  title: string
  agent: string | null
  messages: number
  tokens: number
  created: number
  updated: number
  running: boolean
}

export type StatusFilter = 'all' | 'running' | 'today' | 'older'

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** `{ sessions: [...] }` or a bare list → rows; unusable entries are dropped. */
export function sessionRows(body: unknown, running: ReadonlySet<string> = new Set()): SessionRow[] {
  const list = Array.isArray(body) ? body : body && typeof body === 'object' ? (body as { sessions?: unknown }).sessions : null
  if (!Array.isArray(list)) return []
  const rows: SessionRow[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const s = raw as Record<string, unknown>
    const id = str(s.id) ?? str(s.session_id)
    if (!id) continue
    const created = toMs(s.created_at)
    const updated = toMs(s.updated_at)
    rows.push({
      id,
      title: str(s.title) ?? 'Untitled chat',
      agent: str(s.agent_name) ?? str(s.agent_id) ?? str(s.agent),
      messages: num(s.message_count),
      tokens: num(s.tokens),
      created,
      updated: Number.isFinite(updated) ? updated : created,
      running: running.has(id),
    })
  }
  return rows
}

export function filterRows(
  rows: readonly SessionRow[],
  f: { query: string; status: StatusFilter; agent: string | null; now: number },
): SessionRow[] {
  const q = f.query.trim().toLowerCase()
  const startOfToday = new Date(f.now).setHours(0, 0, 0, 0)
  return rows.filter((r) => {
    if (q && !r.title.toLowerCase().includes(q) && !(r.agent ?? '').toLowerCase().includes(q)) return false
    if (f.agent && r.agent !== f.agent) return false
    if (f.status === 'running') return r.running
    if (f.status === 'today') return r.updated >= startOfToday
    if (f.status === 'older') return !(r.updated >= startOfToday)
    return true
  })
}

const KEY: Record<string, (r: SessionRow) => string | number> = {
  title: (r) => r.title.toLowerCase(),
  agent: (r) => (r.agent ?? '').toLowerCase(),
  messages: (r) => r.messages,
  tokens: (r) => r.tokens,
  updated: (r) => (Number.isFinite(r.updated) ? r.updated : 0),
  status: (r) => (r.running ? 1 : 0),
}

export function sortRows(rows: readonly SessionRow[], sort: ListSort): SessionRow[] {
  const key = KEY[sort.key] ?? KEY.updated
  const dir = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = key(a)
    const y = key(b)
    return x < y ? -dir : x > y ? dir : 0
  })
}
