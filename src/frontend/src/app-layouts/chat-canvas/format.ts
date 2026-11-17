/**
 * Pure helpers of the Chat and Canvas frame: relative times, the top bar's
 * "Researcher · 3 artifacts · edited 2 min ago" line, artifact counts.
 */
import type { Artifact, ChatMessageView } from '@/sdk/layoutTypes'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * A short time for a sidebar row: `now`, `5 min ago`, `2 h ago`,
 * `Yesterday`, a weekday within the week, else `12 Mar`. Undefined for no
 * time or a time in the future beyond a minute of clock skew.
 */
export function relativeTime(at: number | undefined, now = Date.now()): string | undefined {
  if (!at || !Number.isFinite(at)) return undefined
  const ago = now - at
  if (ago < -MIN) return undefined
  if (ago < MIN) return 'now'
  if (ago < HOUR) return `${Math.floor(ago / MIN)} min ago`
  const today = startOfDay(now)
  if (at >= today) return `${Math.floor(ago / HOUR)} h ago`
  if (at >= today - DAY) return 'Yesterday'
  if (at >= today - 6 * DAY) return WEEKDAYS[new Date(at).getDay()]
  const d = new Date(at)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** The chat list's right-aligned time: "now", "4m", "3h", "Yesterday", "Tue", "3 Nov". */
export function shortTime(at: number | undefined, now = Date.now()): string | undefined {
  const rel = relativeTime(at, now)
  if (!rel) return undefined
  const m = /^(\d+) (min|h) ago$/.exec(rel)
  return m ? `${m[1]}${m[2] === 'min' ? 'm' : 'h'}` : rel
}

/** A chat row's second line: "3 artifacts · now", "1 artifact · 2 h ago", or the time alone. */
export function chatRowMeta(artifacts: number | undefined, when: string | undefined): string | undefined {
  const parts = [artifacts ? plural(artifacts, 'artifact') : '', when ?? ''].filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}

/** "edited 2 min ago" wording: `edited now` reads oddly, so `edited just now`. */
function editedPhrase(at: number | undefined, now: number): string | undefined {
  const rel = relativeTime(at, now)
  if (!rel) return undefined
  return rel === 'now' ? 'edited just now' : `edited ${rel === 'Yesterday' ? 'yesterday' : rel}`
}

/** Distinct artifacts (one per key, any version) and the newest change among them. */
export function summarizeArtifacts(list: readonly Artifact[] | null | undefined): { count: number; updatedAt?: number } {
  if (!list || list.length === 0) return { count: 0 }
  const keys = new Set<string>()
  let updatedAt: number | undefined
  for (const a of list) {
    keys.add(a.key)
    if (a.updatedAt && (!updatedAt || a.updatedAt > updatedAt)) updatedAt = a.updatedAt
  }
  return { count: keys.size, updatedAt }
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The agent of the newest assistant message that names one. */
export function lastAgent(messages: readonly ChatMessageView[] | null | undefined): string | undefined {
  if (!messages) return undefined
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && m.agentName) return m.agentName
  }
  return undefined
}

/** The top bar's second line on the chat page: agent · n artifacts · edited …; empty parts are left out. */
/**
 * The connection word after the agent, only while the chat's socket is not
 * open ("connecting", "reconnecting"): an open connection is the normal
 * state, shown once at the sidebar's foot (Canvas.dc.html), not in the line.
 */
export function connectionWord(connection: 'connecting' | 'open' | 'closed' | undefined): { word: string; tone: 'pending' } | null {
  if (connection === 'connecting') return { word: 'connecting', tone: 'pending' }
  if (connection === 'closed') return { word: 'reconnecting', tone: 'pending' }
  return null
}

export function chatSubtitle(
  parts: { agent?: string; artifacts?: number; editedAt?: number; running?: boolean },
  now = Date.now(),
): string {
  const out: string[] = []
  if (parts.agent) out.push(parts.agent)
  if (parts.running) out.push('working')
  if (parts.artifacts) {
    out.push(plural(parts.artifacts, 'artifact'))
    const edited = editedPhrase(parts.editedAt, now)
    if (edited) out.push(edited)
  }
  return out.join(' · ')
}
