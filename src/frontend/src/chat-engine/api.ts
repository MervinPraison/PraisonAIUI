/**
 * REST helpers for the chat page. Same endpoints as views/chat.js:
 *   sessions  GET /api/sessions (falls back to GET /sessions)
 *   rename    PATCH /sessions/{id} {title}
 *   delete    DELETE /sessions/{id}
 *   agents    GET /agents, merged with GET /api/agents/definitions
 *   starters  GET /starters
 * Requests go through window.fetch, which the shell / legacy runtime wraps
 * with the gateway token when one is stored.
 */
import type { AiuiStarter } from './useAiuiRuntime'

export interface ChatSession {
  id: string
  title: string
  /** True when the server had no title and `title` is a fallback. */
  untitled: boolean
  agent?: string
  platform?: string
  updatedAt?: number
}

export interface ChatAgent {
  name: string
  description?: string
}

type Json = Record<string, unknown>

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const ts = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isNaN(t) ? undefined : t
  }
  return undefined
}

async function getJson(url: string): Promise<Json | Json[] | null> {
  const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
  if (!res.ok) return null
  return (await res.json()) as Json | Json[]
}

function listOf(data: Json | Json[] | null, key: string): Json[] {
  if (!data) return []
  const raw = Array.isArray(data) ? data : data[key]
  return Array.isArray(raw) ? (raw.filter((x) => x && typeof x === 'object') as Json[]) : []
}

export function normalizeSession(s: Json): ChatSession | null {
  const id = str(s.id) ?? str(s.session_id)
  if (!id) return null
  const platform = str(s.platform)
  const named = str(s.title) ?? str(s.name) ?? str(s.label)
  const title = platform && !named ? platform.charAt(0).toUpperCase() + platform.slice(1) : named
  return {
    id,
    title: title ?? `Chat ${id.slice(0, 8)}`,
    untitled: !title,
    agent: str(s.agent_id) ?? str(s.agent),
    platform,
    updatedAt: ts(s.updated_at) ?? ts(s.created_at),
  }
}

export async function fetchSessions(): Promise<ChatSession[]> {
  let data = await getJson('/api/sessions').catch(() => null)
  if (!data) data = await getJson('/sessions')
  const out = listOf(data, 'sessions').map(normalizeSession).filter((s): s is ChatSession => s !== null)
  // newest first; sessions without a timestamp keep the server's order at the end
  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (b.s.updatedAt ?? -Infinity) - (a.s.updatedAt ?? -Infinity) || a.i - b.i)
    .map(({ s }) => s)
}

export async function renameSession(id: string, title: string): Promise<void> {
  const res = await fetch(`/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error(res.status === 404 ? 'This chat no longer exists' : `Rename failed (HTTP ${res.status})`)
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' })
  // 404: already gone (or never persisted) — the outcome the user asked for.
  if (!res.ok && res.status !== 404) throw new Error(`Delete failed (HTTP ${res.status})`)
}

export async function fetchAgents(): Promise<ChatAgent[]> {
  const [registry, defs] = await Promise.all([
    getJson('/agents').catch(() => null),
    getJson('/api/agents/definitions').catch(() => null),
  ])
  const seen = new Set<string>()
  const out: ChatAgent[] = []
  const raw = (d: Json | Json[] | null): unknown[] => {
    const v = Array.isArray(d) ? d : d?.agents
    return Array.isArray(v) ? v : []
  }
  for (const a of [...raw(registry), ...raw(defs)]) {
    const rec = a && typeof a === 'object' ? (a as Json) : null
    const name = typeof a === 'string' ? str(a) : rec ? str(rec.name) ?? str(rec.agent_id) ?? str(rec.id) : undefined
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push({ name, description: rec ? str(rec.description) : undefined })
  }
  return out
}

export async function fetchStarters(): Promise<AiuiStarter[]> {
  const data = await getJson('/starters').catch(() => null)
  return listOf(data, 'starters')
    .map((s): AiuiStarter | null => {
      const prompt = str(s.message) ?? str(s.prompt)
      if (!prompt) return null
      const label = str(s.label) ?? str(s.title)
      const icon = str(s.icon)
      return { title: [icon, label ?? prompt].filter(Boolean).join(' '), label: label && label !== prompt ? prompt : undefined, prompt }
    })
    .filter((s): s is AiuiStarter => s !== null)
}
