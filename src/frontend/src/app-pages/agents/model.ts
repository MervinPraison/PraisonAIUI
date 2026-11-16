/**
 * Agents page data, pure (app-pages.test.tsx): rows from
 * GET /api/agents/definitions, the toolbar filter, the column sort, and the
 * create/edit form's draft and request body.
 */
import type { ListSort } from '@/components/page/ListDetail'
import { toMs } from '../shared'

export interface AgentRow {
  id: string
  name: string
  description: string
  instructions: string
  systemPrompt: string
  model: string
  temperature: number
  tools: string[]
  status: string
  /** Registered by the app in code (the gateway): read-only here. */
  fromCode: boolean
  created: number
  updated: number
}

/** The form's fields, as typed (temperature too, so it can be checked). */
export type AgentDraft = Record<'name' | 'description' | 'model' | 'temperature' | 'instructions' | 'systemPrompt', string>

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const toolName = (t: unknown) => (typeof t === 'string' ? t : t && typeof t === 'object' ? str((t as { name?: unknown }).name) : '')

/** `{ agents: [...] }` or a bare list → rows; entries without an id are dropped. */
export function agentRows(body: unknown): AgentRow[] {
  const list = Array.isArray(body) ? body : body && typeof body === 'object' ? (body as { agents?: unknown }).agents : null
  if (!Array.isArray(list)) return []
  const rows: AgentRow[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const a = raw as Record<string, unknown>
    const id = str(a.id)
    if (!id) continue
    const created = toMs(a.created_at)
    const updated = toMs(a.updated_at)
    const temperature = Number(a.temperature)
    rows.push({
      id,
      name: str(a.name) || id,
      description: str(a.description),
      instructions: str(a.instructions),
      systemPrompt: str(a.system_prompt),
      model: str(a.model),
      temperature: Number.isFinite(temperature) ? temperature : 0.7,
      tools: Array.isArray(a.tools) ? a.tools.map(toolName).filter(Boolean) : [],
      status: str(a.status) || 'active',
      fromCode: a.source === 'gateway',
      created,
      updated: Number.isFinite(updated) ? updated : created,
    })
  }
  return rows
}

/** One line for the table: the description, else the start of the instructions. */
export function summaryOf(row: AgentRow): string {
  const text = row.description || row.instructions || row.systemPrompt
  return text.split('\n')[0]
}

/** "Research bot" → "RB", "writer" → "W". */
export function monogram(name: string): string {
  const words = name.split(/[\s_-]+/).filter(Boolean)
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?')[0]
  return letters.toUpperCase()
}

export function filterAgents(rows: readonly AgentRow[], f: { query: string; model: string | null }): AgentRow[] {
  const q = f.query.trim().toLowerCase()
  return rows.filter((r) => {
    if (f.model && r.model !== f.model) return false
    if (!q) return true
    return [r.name, r.description, r.instructions, r.model].some((t) => t.toLowerCase().includes(q))
  })
}

const KEY: Record<string, (r: AgentRow) => string | number> = {
  name: (r) => r.name.toLowerCase(),
  summary: (r) => summaryOf(r).toLowerCase(),
  model: (r) => r.model.toLowerCase(),
  tools: (r) => r.tools.length,
  updated: (r) => (Number.isFinite(r.updated) ? r.updated : 0),
  status: (r) => r.status,
}

export function sortAgents(rows: readonly AgentRow[], sort: ListSort): AgentRow[] {
  const key = KEY[sort.key] ?? KEY.name
  const dir = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = key(a)
    const y = key(b)
    return x < y ? -dir : x > y ? dir : 0
  })
}

/** The models to offer: the server's list, plus the agent's own if it is not in it. */
export function modelOptions(body: unknown, current = ''): string[] {
  const list = body && typeof body === 'object' ? (body as { models?: unknown }).models : null
  const models = Array.isArray(list) ? list.filter((m): m is string => typeof m === 'string' && !!m) : []
  return current && !models.includes(current) ? [current, ...models] : models
}

export function defaultModel(body: unknown): string {
  const d = body && typeof body === 'object' ? (body as { default?: unknown }).default : null
  return typeof d === 'string' && d ? d : modelOptions(body)[0] ?? ''
}

export function draftOf(row: AgentRow | null, model: string): AgentDraft {
  const r = row ?? { name: '', description: '', instructions: '', systemPrompt: '', model: '', temperature: 0.7 }
  return { name: r.name, description: r.description, model: r.model || model, temperature: String(r.temperature), instructions: r.instructions, systemPrompt: r.systemPrompt }
}

/** What is wrong with the draft, or null. */
export function draftError(d: AgentDraft): string | null {
  if (!d.name.trim()) return 'Give the agent a name.'
  const t = Number(d.temperature)
  if (d.temperature.trim() === '' || !Number.isFinite(t) || t < 0 || t > 2) return 'Temperature is a number from 0 to 2.'
  return null
}

/** The body for POST /api/agents/definitions and PUT …/{id}. Tools and icon are left as they are. */
export function payloadOf(d: AgentDraft): Record<string, unknown> {
  const t = (s: string) => s.trim()
  return { name: t(d.name), description: t(d.description), model: d.model, temperature: Number(d.temperature), instructions: t(d.instructions), system_prompt: t(d.systemPrompt) }
}

/** "Active", "Paused": the status in sentence case. */
export function statusLabel(status: string): string {
  return status ? status[0].toUpperCase() + status.slice(1).toLowerCase() : 'Active'
}
