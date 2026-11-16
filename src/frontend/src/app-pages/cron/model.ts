/**
 * Cron page data, pure (app-pages.test.tsx): rows and run history from the
 * schedules API, a schedule in words, a five-field cron parser with the next
 * run times (UTC: the server's croniter reads a float start time as UTC),
 * and the schedule builder's draft.
 */
import type { ListSort } from '@/components/page/ListDetail'
import { toMs } from '../shared'

export interface Schedule { kind: string; every_seconds?: number | null; cron_expr?: string | null; at?: number | null }
export interface JobRow { id: string; name: string; message: string; agent: string | null; schedule: Schedule; enabled: boolean; created: number; lastRun: number; lastStatus: string | null; runs: number }
export interface RunEntry { jobId: string; status: string; result: string; at: number; duration: number }
export type StatusFilter = 'all' | 'enabled' | 'paused' | 'failing'

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
const items = (body: unknown, key: string): Record<string, unknown>[] => {
  const v = Array.isArray(body) ? body : body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : null
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []
}

export function jobRows(body: unknown): JobRow[] {
  return items(body, 'schedules').flatMap((j) => {
    const id = str(j.id)
    if (!id) return []
    const schedule = j.schedule && typeof j.schedule === 'object' ? (j.schedule as Schedule) : { kind: 'every' }
    const runs = typeof j.run_count === 'number' ? j.run_count : 0
    return [{ id, name: str(j.name) ?? id, message: str(j.message) ?? '', agent: str(j.agent_name) ?? str(j.agent_id), schedule, enabled: j.enabled !== false, created: toMs(j.created_at), lastRun: toMs(j.last_run_at), lastStatus: str(j.last_status), runs }]
  })
}

/** GET /api/schedules/history, newest first. */
export function runHistory(body: unknown): RunEntry[] {
  return items(body, 'history').flatMap((h) => {
    const jobId = str(h.job_id)
    return jobId ? [{ jobId, status: str(h.status) ?? 'unknown', result: typeof h.result === 'string' ? h.result : '', at: toMs(h.timestamp), duration: Number(h.duration) || 0 }] : []
  })
}

const pad = (v: string | number) => String(v).padStart(2, '0')
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
// [min, max, names, label] of minute, hour, day of month, month, weekday (7 is Sunday too).
const FIELDS: readonly [number, number, string[] | null, string][] = [[0, 59, null, 'minute'], [0, 23, null, 'hour'], [1, 31, null, 'day of month'], [1, 12, MONTHS, 'month'], [0, 7, DAYS, 'weekday']]

export interface CronSpec { fields: Set<number>[]; domAny: boolean; dowAny: boolean }

function parseField(src: string, [min, max, names]: (typeof FIELDS)[number]): Set<number> | null {
  const out = new Set<number>()
  const val = (v: string) => (/^\d+$/.test(v) ? Number(v) : names?.includes(v) ? names.indexOf(v) + min : Number.NaN)
  for (const part of src.toLowerCase().split(',')) {
    const m = /^(\*|[a-z0-9]+(?:-[a-z0-9]+)?)(?:\/(\d+))?$/.exec(part)
    if (!m) return null
    const step = m[2] ? Number(m[2]) : 1
    const [a, b] = m[1] === '*' ? [min, max] : m[1].split('-').map(val)
    const [lo, hi] = [a, b ?? (m[2] ? max : a)]
    if (!(step >= 1 && lo >= min && hi <= max && lo <= hi)) return null
    for (let v = lo; v <= hi; v += step) out.add(v === 7 && names === DAYS ? 0 : v)
  }
  return out
}

/** A five-field cron expression, or why it is not one. */
export function parseCron(expr: string): { spec: CronSpec; error?: undefined } | { spec?: undefined; error: string } {
  const f = expr.trim().split(/\s+/).filter(Boolean)
  if (f.length !== 5) return { error: 'Use five fields: minute, hour, day of month, month, weekday.' }
  const fields = f.map((src, i) => parseField(src, FIELDS[i]))
  const bad = fields.findIndex((s) => !s)
  if (bad >= 0) return { error: `The ${FIELDS[bad][3]} field “${f[bad]}” is not valid.` }
  // A day field is unrestricted when it covers its whole domain (as croniter): */2 is not.
  const [dom, dow] = [fields[2] as Set<number>, fields[4] as Set<number>]
  return { spec: { fields: fields as Set<number>[], domAny: dom.size === 31, dowAny: dow.size === 7 } }
}

/** The next `count` run times (epoch ms, UTC) strictly after `from`. */
export function nextRuns(spec: CronSpec, from: number, count = 3): number[] {
  const [minute, hour, dom, month, dow] = spec.fields
  const out: number[] = []
  let t = Math.floor(from / 60_000) * 60_000 + 60_000
  for (let guard = 0; guard < 100_000 && out.length < count; guard++) {
    const d = new Date(t)
    const [y, mo, day, h] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()]
    // croniter (as Vixie cron): with both day fields set, either may match.
    const dayOk = spec.domAny ? spec.dowAny || dow.has(d.getUTCDay()) : spec.dowAny ? dom.has(day) : dom.has(day) || dow.has(d.getUTCDay())
    if (!month.has(mo + 1)) t = Date.UTC(y, mo + 1, 1)
    else if (!dayOk) t = Date.UTC(y, mo, day + 1)
    else if (!hour.has(h)) t = Date.UTC(y, mo, day, h + 1)
    else {
      if (minute.has(d.getUTCMinutes())) out.push(t)
      t += 60_000
    }
  }
  return out
}

const every = (n: number, unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`)

function dayList(days: number[]): string {
  const named = ({ '1,2,3,4,5': 'Weekdays', '0,6': 'Weekends', '0,1,2,3,4,5,6': 'Every day' } as Record<string, string>)[days.join(',')]
  if (named) return named
  if (days.length === 1) return `Every ${DAY_NAMES[days[0]]}`
  const names = days.map((d) => DAY_NAMES[d].slice(0, 3))
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** "Every 15 minutes", "Every day at 09:00 UTC", "Weekdays at 08:30 UTC". */
export function describeSchedule(s: Schedule): string {
  const sec = s.every_seconds ?? 0
  if (s.kind === 'every' && sec > 0) {
    const unit = ([[86_400, 'day'], [3600, 'hour'], [60, 'minute'], [1, 'second']] as const).find(([n]) => sec % n === 0) ?? [1, 'second']
    return every(sec / unit[0], unit[1])
  }
  if (s.kind === 'once' && s.at) return `Once, ${new Date(toMs(s.at)).toLocaleString()}`
  const expr = s.cron_expr?.trim() ?? ''
  const p = parseCron(expr)
  if (!p.spec) return expr ? 'Custom schedule' : 'No schedule'
  const [mi, h, dom, mon, dow] = expr.split(/\s+/)
  const num = /^\d+$/
  if (h === '*' && dom === '*' && mon === '*' && dow === '*') {
    if (mi === '*') return 'Every minute'
    if (/^\*\/\d+$/.test(mi)) return every(Number(mi.slice(2)), 'minute')
    if (num.test(mi)) return Number(mi) === 0 ? 'Every hour' : `Every hour at :${pad(mi)}`
  }
  if (num.test(mi) && num.test(h) && mon === '*') {
    const at = `at ${pad(h)}:${pad(mi)} UTC`
    if (dom === '*' && dow === '*') return `Every day ${at}`
    if (dom === '*') return `${dayList([...p.spec.fields[4]].sort())} ${at}`
    if (dow === '*' && num.test(dom)) return `Monthly on day ${dom} ${at}`
  }
  return 'Custom schedule'
}

/** When the server next runs the job (its loop ticks every 15 s), or null. */
export function nextRun(row: Pick<JobRow, 'schedule' | 'enabled' | 'lastRun' | 'created'>, now: number): { at: number; due: boolean } | null {
  const base = Number.isFinite(row.lastRun) ? row.lastRun : row.created
  const s = row.schedule
  if (!row.enabled || !Number.isFinite(base)) return null
  const spec = s.kind !== 'once' && s.cron_expr ? parseCron(s.cron_expr).spec : undefined
  const at = s.kind === 'every' && (s.every_seconds ?? 0) > 0 ? base + (s.every_seconds ?? 0) * 1000 : spec && nextRuns(spec, base, 1)[0]
  return at === undefined ? null : { at, due: at <= now }
}

/** A future time: "in 5 min", "in 3 h", then clock(). */
export function until(at: number, now: number): string {
  const d = at - now
  if (d < 3_600_000) return d < 60_000 ? 'in under a minute' : `in ${Math.round(d / 60_000)} min`
  return d < 6 * 3_600_000 ? `in ${Math.round(d / 3_600_000)} h` : clock(at, now)
}

/** "Today 09:00", "Tomorrow 09:00", "Mon 09:00", "Dec 2, 09:00" (local). */
export function clock(at: number, now: number): string {
  const date = new Date(at)
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days === 0 || days === 1) return `${days ? 'Tomorrow' : 'Today'} ${hm}`
  if (days > 1 && days < 7) return `${DAY_NAMES[date.getDay()].slice(0, 3)} ${hm}`
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${hm}`
}

// ── The builder ──

export type Repeat = 'minutes' | 'hours' | 'daily' | 'weekly' | 'custom'
export interface Draft { repeat: Repeat; every: number; time: string; days: number[]; cron: string }
export const NEW_DRAFT: Draft = { repeat: 'daily', every: 15, time: '09:00', days: [1], cron: '0 9 * * 1-5' }

export function draftSchedule(d: Draft): { schedule: Schedule; error?: undefined } | { schedule?: undefined; error: string } {
  if (d.repeat === 'minutes' || d.repeat === 'hours') {
    const max = d.repeat === 'minutes' ? 1440 : 168
    if (!(Number.isInteger(d.every) && d.every >= 1 && d.every <= max)) return { error: `Enter a whole number from 1 to ${max}.` }
    return { schedule: { kind: 'every', every_seconds: d.every * (d.repeat === 'minutes' ? 60 : 3600) } }
  }
  if (d.repeat === 'custom') {
    const p = parseCron(d.cron)
    return p.error ? { error: p.error } : { schedule: { kind: 'cron', cron_expr: d.cron.trim().split(/\s+/).join(' ') } }
  }
  const m = /^(\d{1,2}):(\d{2})$/.exec(d.time)
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { error: 'Pick a time.' }
  if (d.repeat === 'weekly' && d.days.length === 0) return { error: 'Pick at least one day.' }
  const days = d.repeat === 'daily' ? '*' : [...d.days].sort().join(',')
  return { schedule: { kind: 'cron', cron_expr: `${Number(m[2])} ${Number(m[1])} * * ${days}` } }
}

/** The builder's view of a stored schedule (Edit). */
export function scheduleDraft(s: Schedule): Draft {
  const sec = s.every_seconds ?? 0
  if (s.kind === 'every' && sec > 0) return sec % 3600 === 0 ? { ...NEW_DRAFT, repeat: 'hours', every: sec / 3600 } : { ...NEW_DRAFT, repeat: 'minutes', every: Math.max(1, Math.round(sec / 60)) }
  const [mi, h, dom, mon, dow] = (s.cron_expr ?? '').trim().split(/\s+/)
  if (/^\d+$/.test(mi) && /^\d+$/.test(h) && Number(mi) < 60 && Number(h) < 24 && dom === '*' && mon === '*') {
    const time = `${pad(h)}:${pad(mi)}`
    if (dow === '*') return { ...NEW_DRAFT, repeat: 'daily', time }
    if (/^[0-6](,[0-6])*$/.test(dow)) return { ...NEW_DRAFT, repeat: 'weekly', time, days: dow.split(',').map(Number) }
  }
  return { ...NEW_DRAFT, repeat: 'custom', cron: s.cron_expr ?? '' }
}

// ── Toolbar ──

export function filterRows(rows: readonly JobRow[], query: string, status: StatusFilter): JobRow[] {
  const q = query.trim().toLowerCase()
  const keep = { all: () => true, enabled: (r: JobRow) => r.enabled, paused: (r: JobRow) => !r.enabled, failing: (r: JobRow) => r.lastStatus === 'failed' }[status]
  return rows.filter((r) => keep(r) && (!q || [r.name, r.message, r.agent ?? ''].some((v) => v.toLowerCase().includes(q))))
}

export function sortRows(rows: readonly JobRow[], sort: ListSort, now: number): JobRow[] {
  const keys: Record<string, (r: JobRow) => string | number> = { next: (r) => nextRun(r, now)?.at ?? Infinity, last: (r) => (Number.isFinite(r.lastRun) ? r.lastRun : 0), agent: (r) => (r.agent ?? '').toLowerCase() }
  const key = keys[sort.key] ?? ((r: JobRow) => r.name.toLowerCase())
  const dir = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => (key(a) < key(b) ? -dir : key(a) > key(b) ? dir : 0))
}
