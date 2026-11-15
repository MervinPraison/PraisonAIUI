import type { ApprovalItem } from '@/sdk/layoutTypes'

/** An approval's call as one line (`pip install numpy`), at most 200 characters. */
export function describeCall(item: Pick<ApprovalItem, 'toolName' | 'args'>): string {
  const args = item.args ?? {}
  const values = Object.values(args)
  const text =
    values.length === 1 && typeof values[0] === 'string'
      ? values[0]
      : `${item.toolName ?? 'tool'}(${Object.keys(args).length ? JSON.stringify(args) : ''})`
  return text.length > 200 ? `${text.slice(0, 199)}…` : text
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * When a chat was last active, as a session list shows it (Pro: Now, 2h,
 * Yesterday, Mon, Jan 5). Local calendar days decide Yesterday and the
 * weekday; a time in the future counts as now. '' when unknown.
 */
export function relativeTime(at: number | undefined, now = Date.now()): string {
  if (typeof at !== 'number' || !Number.isFinite(at)) return ''
  const ago = now - at
  if (ago < MINUTE) return 'Now'
  if (ago < HOUR) return `${Math.floor(ago / MINUTE)}m`
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  if (at >= startOfToday) return `${Math.floor(ago / HOUR)}h`
  if (at >= startOfToday - DAY) return 'Yesterday'
  const date = new Date(at)
  if (at >= startOfToday - 6 * DAY) return date.toLocaleDateString('en-US', { weekday: 'short' })
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}
