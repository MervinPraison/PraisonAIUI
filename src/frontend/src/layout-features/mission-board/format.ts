/**
 * Mission Control number and time formats (pure; format.test.ts). KPI
 * numerals use tabular figures in the UI, so every value here keeps a
 * stable width for the same magnitude.
 */

const DASH = '—'

/** 3412 → "3,412" (en-US grouping, locale-independent so tests and screenshots agree). */
export function formatCount(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return DASH
  return Math.round(n).toLocaleString('en-US')
}

/** Change against the previous window: "+6", "−2", "±0"; '' when unknown. */
export function formatDelta(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return ''
  if (n === 0) return '±0'
  return n > 0 ? `+${formatCount(n)}` : `−${formatCount(-n)}`
}

/** 0.976 → "97.6%", 1 → "100%", 0 → "0%". */
export function formatPercent(rate: number | undefined): string {
  if (rate === undefined || !Number.isFinite(rate)) return DASH
  const pct = Math.min(Math.max(rate, 0), 1) * 100
  const text = pct.toFixed(1)
  return `${text.endsWith('.0') ? text.slice(0, -2) : text}%`
}

/** Two significant digits, never fewer than two decimals: 0.0123 → "0.012", 0.07 → "0.07", 0.004 → "0.004". */
function twoSignificant(v: number): string {
  const t = v.toPrecision(2)
  const [whole, frac = ''] = t.split('.')
  let f = frac
  while (f.length > 2 && f.endsWith('0')) f = f.slice(0, -1)
  return `${whole}.${f.padEnd(2, '0')}`
}

/** US dollars: "$1.84", "$0.07", "$0.012" (two significant digits under a dime), "<$0.001", "$1,240". */
export function formatCost(usd: number | undefined): string {
  if (usd === undefined || !Number.isFinite(usd)) return DASH
  const v = Math.max(usd, 0)
  if (v === 0) return '$0.00'
  if (v < 0.001) return '<$0.001'
  if (v < 0.1) return `$${twoSignificant(v)}`
  if (v < 1000) return `$${v.toFixed(2)}`
  return `$${formatCount(v)}`
}

/** A step or latency: "0.3s", "2.1s", "1m 05s", "1h 02m"; "<0.1s" under 100 ms. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return DASH
  if (ms < 100) return '<0.1s'
  if (ms < 60_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`
  const s = Math.floor(ms / 1000)
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

/** A waiting timer: 42 s → "0:42", 75 min → "1:15:00". */
export function formatClock(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return DASH
  const s = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}

/** "just now", "38m ago", "3h ago", "2d ago". */
export function formatAgo(at: number | undefined, now: number): string {
  if (at === undefined || !Number.isFinite(at)) return DASH
  const s = Math.max(0, Math.floor((now - at) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86_400)}d ago`
}

/** Wall-clock time of an epoch ms as HH:MM:SS (24 h, the viewer's time zone). */
export function formatTime(at: number | undefined): string {
  if (at === undefined || !Number.isFinite(at)) return DASH
  const d = new Date(at)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}

/** "3,412 tok". */
export function formatTokens(n: number | undefined): string {
  return n === undefined || !Number.isFinite(n) ? '' : `${formatCount(n)} tok`
}

/** Join the parts that have text with " · " (the designs' meta lines). */
export function metaLine(...parts: (string | undefined | null | false)[]): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' · ')
}
