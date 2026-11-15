/**
 * The run inspector's model (ADR 0003 track K): the latest run of the open
 * chat, derived from the `chat` feed's messages. Pure: no React, no DOM.
 *
 *   deriveRun(messages, now, seen)  status, steps with timings, files
 *                                   touched, the pending approval
 *   deriveFiles(parts)              files the run's tools wrote or read
 *   formatDuration / formatCost / formatTokens
 *
 * Steps come from the assistant message's parts: reasoning and tool calls
 * carry their own timing (`AiuiTiming`); the answer text has none, so it
 * runs from the end of the step before it to the message's completedAt.
 */
import type { ChatMessageView, ChatPartView, ChatToolPartView } from '@/sdk/layoutTypes'

export type InspectorRunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'
export type InspectorStepState = 'running' | 'done' | 'waiting' | 'error'

export interface InspectorStep {
  id: string
  /** 1-based, as `01`. */
  n: string
  kind: 'reasoning' | 'tool' | 'response'
  /** `reasoning`, `tool · terminal`, `response`. */
  kindLabel: string
  title: string
  detail: string
  state: InspectorStepState
  startedAt: number
  endedAt?: number
  /** Milliseconds (to `now` while open). */
  durationMs: number
  /** Position on the run's time bar, 0..100 (percent). */
  x: number
  w: number
  /** The step's full text for the expanded row (the reasoning, the tool result). */
  body?: string
}

export interface InspectorFile {
  path: string
  state: 'written' | 'read' | 'deleted' | 'if approved' | 'failed'
}

export interface InspectorApproval {
  id: string
  toolName: string
  /** The exact call (`pip install numpy`). */
  call: string
  isCommand: boolean
  description?: string
  risk?: string
  /** When the inspector first saw it (epoch ms). */
  since: number
}

export interface InspectorRun {
  messageId: string
  runId?: string
  agent?: string
  status: InspectorRunStatus
  startedAt: number
  endedAt?: number
  elapsedMs: number
  /** Time spent waiting on the pending approval. */
  waitingMs: number
  steps: InspectorStep[]
  doneSteps: number
  files: InspectorFile[]
  approval?: InspectorApproval
}

// ── formatting ───────────────────────────────────────────────────────

/** `0.3s`, `4.4s`; a minute or more as `1:05`. `clock` forces `m:ss` (waiting times). */
export function formatDuration(ms: number, clock = false): string {
  const v = Math.max(0, Number.isFinite(ms) ? ms : 0)
  if (!clock && v < 60_000) return `${(v / 1000).toFixed(1)}s`
  const s = Math.floor(v / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** `$0.00045`, `$0.012`, `$1.24`; null for an unknown cost. */
export function formatCost(cost: number | undefined | null): string | null {
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) return null
  if (cost === 0) return '$0.00'
  if (cost >= 1) return `$${cost.toFixed(2)}`
  if (cost >= 0.01) return `$${cost.toFixed(3)}`
  if (cost < 0.000001) return '<$0.000001'
  return `$${Number(cost.toPrecision(2)).toFixed(Math.min(8, 1 - Math.floor(Math.log10(cost))))}`
}

/** `1,432`; null for an unknown count. */
export function formatTokens(n: number | undefined | null): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null
  return Math.round(n).toLocaleString('en-US')
}

// ── files ────────────────────────────────────────────────────────────

const PATH_KEYS = ['path', 'file', 'file_path', 'filepath', 'filename', 'target', 'destination', 'dest', 'output', 'output_path']
const READ_TOOL = /(^|[_\-.])(read|cat|open|view|get|list|ls|search|grep|find|glob|fetch)([_\-.]|$)/i
const DELETE_TOOL = /(^|[_\-.])(delete|remove|rm|unlink)([_\-.]|$)/i
const COMMAND_KEYS = ['cmd', 'command', 'script', 'shell']

const looksLikePath = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length < 300 && !/\s/.test(v.trim()) && /[./]/.test(v) && !/^[a-z]+:\/\//i.test(v)

function commandOf(args: Readonly<Record<string, unknown>>): string | undefined {
  for (const k of COMMAND_KEYS) if (typeof args[k] === 'string' && args[k]) return args[k] as string
  return undefined
}

/** Files a shell command writes (`> f`, `>> f`, `tee f`, `touch f`, `mkdir d`, `cp|mv a b`) or deletes (`rm f`). */
export function filesOfCommand(cmd: string): { path: string; deleted?: boolean }[] {
  const out: { path: string; deleted?: boolean }[] = []
  for (const m of cmd.matchAll(/(?:^|[^<>&\d])>>?\s*([^\s;&|<>]+)/g)) out.push({ path: m[1] })
  for (const segment of cmd.split(/&&|\|\||;|\|/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean)
    const [bin, ...rest] = words
    const operands = rest.filter((w) => !w.startsWith('-') && !/[<>]/.test(w))
    if (!bin || operands.length === 0) continue
    if (bin === 'tee' || bin === 'touch' || bin === 'mkdir') for (const p of operands) out.push({ path: p })
    else if ((bin === 'cp' || bin === 'mv') && operands.length >= 2) out.push({ path: operands[operands.length - 1] })
    else if (bin === 'rm') for (const p of operands) out.push({ path: p, deleted: true })
  }
  return out.filter((f) => f.path && f.path !== '/dev/null')
}

/** Files touched by the run's tool calls, in first-touch order; a later touch updates the state. */
export function deriveFiles(parts: readonly ChatPartView[]): InspectorFile[] {
  const byPath = new Map<string, InspectorFile>()
  for (const p of parts) {
    if (p.type !== 'tool-call') continue
    const pending = !!p.approval && p.approval.approved === undefined
    const denied = p.approval?.approved === false
    const found: { path: string; deleted?: boolean }[] = []
    for (const k of PATH_KEYS) if (looksLikePath(p.args[k])) found.push({ path: (p.args[k] as string).trim() })
    const many = p.args.paths ?? p.args.files
    if (Array.isArray(many)) for (const v of many) if (looksLikePath(v)) found.push({ path: v.trim() })
    const cmd = commandOf(p.args)
    if (cmd) found.push(...filesOfCommand(cmd))
    for (const f of found) {
      let state: InspectorFile['state']
      if (pending) state = 'if approved'
      else if (denied || p.isError) state = 'failed'
      else if (f.deleted || (!cmd && DELETE_TOOL.test(p.toolName))) state = 'deleted'
      else if (!cmd && READ_TOOL.test(p.toolName)) state = 'read'
      else state = 'written'
      const prev = byPath.get(f.path)
      // A read never downgrades a write.
      if (prev && state === 'read' && prev.state !== 'read') continue
      byPath.set(f.path, { path: f.path, state })
    }
  }
  return [...byPath.values()]
}

// ── steps ────────────────────────────────────────────────────────────

const firstLine = (v: unknown, max = 40): string => {
  let s = ''
  if (typeof v === 'string') s = v
  else if (typeof v === 'number' || typeof v === 'boolean') s = String(v)
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const pick = o.stdout ?? o.output ?? o.text ?? o.content ?? o.result
    s = typeof pick === 'string' ? pick : JSON.stringify(v)
  }
  const line = s.trim().split('\n')[0]?.trim() ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

const bodyOf = (v: unknown): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  return s.length > 4000 ? `${s.slice(0, 3999)}…` : s
}

function answerShape(text: string): string {
  const has = [/^\s*\|.*\|\s*\n\s*\|[\s:|-]+\|/m.test(text) && 'table', /```/.test(text) && 'code'].filter(Boolean)
  return has.length ? `markdown · ${has.join(' + ')}` : 'markdown'
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

function toolTitle(p: ChatToolPartView): { title: string; isCommand: boolean } {
  const cmd = commandOf(p.args)
  if (cmd) return { title: `$ ${cmd.length > 200 ? `${cmd.slice(0, 199)}…` : cmd}`, isCommand: true }
  const label = typeof p.artifact.label === 'string' && p.artifact.label ? p.artifact.label : ''
  // Not the kit's describeCall: a module the frame shares would land in the frame's chunk.
  const values = Object.values(p.args)
  const call = values.length === 1 && typeof values[0] === 'string' ? values[0] : `${p.toolName}(${values.length ? JSON.stringify(p.args) : ''})`
  return { title: label || (call.length > 200 ? `${call.slice(0, 199)}…` : call), isCommand: false }
}

const isPendingApproval = (p: ChatPartView): p is ChatToolPartView & { approval: NonNullable<ChatToolPartView['approval']> } =>
  p.type === 'tool-call' && !!p.approval && p.approval.approved === undefined

/** The latest assistant message: the run the inspector shows. */
export function latestRunMessage(messages: readonly ChatMessageView[]): ChatMessageView | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') return messages[i]
  return undefined
}

/**
 * The latest run of `messages`, or null when the chat has no answer yet.
 * `seen` remembers when each approval was first seen (the caller keeps it
 * across renders), so its waiting time keeps counting.
 */
export function deriveRun(messages: readonly ChatMessageView[], now: number, seen: Map<string, number> = new Map()): InspectorRun | null {
  const m = latestRunMessage(messages)
  if (!m) return null
  const st = m.status?.type
  const pending = m.parts.find(isPendingApproval)
  const open = st === 'running' || st === 'requires-action' || (!!pending && st !== 'complete' && st !== 'incomplete')
  let status: InspectorRunStatus
  if (pending && st !== 'incomplete') status = 'waiting'
  else if (st === 'requires-action') status = 'waiting'
  else if (st === 'running') status = 'running'
  else if (st === 'incomplete') status = m.status?.type === 'incomplete' && m.status.reason === 'cancelled' ? 'cancelled' : 'failed'
  else status = 'completed'

  const startedAt = m.createdAt
  const endedAt = open || status === 'waiting' ? undefined : (m.completedAt ?? undefined)
  // A finished reply from history may carry no completedAt: its last step's end, else its start.
  const end = endedAt ?? (status === 'running' || status === 'waiting' ? now : (lastTime(m) ?? startedAt))

  let approval: InspectorApproval | undefined
  if (pending && status === 'waiting') {
    const since = seen.get(pending.approval.id) ?? now
    seen.set(pending.approval.id, since)
    const { title, isCommand } = toolTitle(pending)
    const description = typeof pending.artifact.description === 'string' && pending.artifact.description
      ? pending.artifact.description
      : pending.approval.prompt
    const risk = typeof pending.artifact.risk_level === 'string' ? pending.artifact.risk_level : undefined
    approval = { id: pending.approval.id, toolName: pending.toolName, call: isCommand ? title.slice(2) : title, isCommand, description, risk, since }
  }

  const raw: Omit<InspectorStep, 'n' | 'x' | 'w'>[] = []
  let cursor = startedAt
  // The answer is one step, at the place of its first text part.
  const text = m.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n')
  let answerAt = -1
  let answerStart = startedAt
  for (const p of m.parts) {
    if (p.type === 'text') {
      if (answerAt < 0 && p.text.trim()) {
        answerAt = raw.length
        answerStart = cursor
      }
    } else if (p.type === 'reasoning') {
      const s = p.timing?.startedAt ?? cursor
      const e = p.timing?.completedAt ?? (p.done ? s : undefined)
      const dur = (e ?? end) - s
      raw.push({
        id: p.id, kind: 'reasoning', kindLabel: 'reasoning',
        title: e !== undefined ? `Thought for ${Math.max(1, Math.round(dur / 1000))}s` : 'Thinking…',
        detail: firstLine(p.text), state: e !== undefined ? 'done' : 'running',
        startedAt: s, endedAt: e, durationMs: dur, body: bodyOf(p.text),
      })
      cursor = e ?? cursor
    } else if (p.type === 'tool-call') {
      const s = p.timing?.startedAt ?? cursor
      const waiting = isPendingApproval(p) && status === 'waiting'
      const e = waiting ? undefined : (p.timing?.completedAt ?? (p.result !== undefined ? s : undefined))
      const { title } = toolTitle(p)
      const waitStart = waiting ? (seen.get(p.approval!.id) ?? now) : s
      const state: InspectorStepState = waiting ? 'waiting' : p.isError || p.approval?.approved === false ? 'error' : e !== undefined ? 'done' : status === 'running' ? 'running' : 'done'
      const result = p.result !== undefined ? firstLine(p.result) : ''
      const detail = waiting
        ? 'needs approval · A / D'
        : p.approval?.approved === false
          ? 'denied'
          : p.isError
            ? `failed${result ? ` · ${result}` : ''}`
            : result ? `→ ${result}` : ''
      raw.push({
        id: p.id, kind: 'tool', kindLabel: `tool · ${p.toolName}`, title, detail, state,
        startedAt: s, endedAt: e, durationMs: waiting ? now - waitStart : (e ?? end) - s,
        body: bodyOf(p.result),
      })
      if (e !== undefined) cursor = Math.max(cursor, e)
    }
  }
  if (answerAt >= 0) {
    const s = Math.min(answerStart, end)
    // It ends where the next step starts (a tool after the text), else with the run.
    const next = raw[answerAt]
    const answerDone = !!next || status !== 'running'
    const e = next ? Math.max(s, next.startedAt) : end
    raw.splice(answerAt, 0, {
      id: `${m.id}-answer`, kind: 'response', kindLabel: 'response', title: answerShape(text),
      detail: `${words(text)} words`, state: answerDone ? 'done' : 'running',
      startedAt: s, endedAt: answerDone ? e : undefined, durationMs: Math.max(0, e - s), body: undefined,
    })
  }

  const span = Math.max(1, end - startedAt)
  const pct = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10
  const steps: InspectorStep[] = raw.map((r, i) => {
    const x = pct(((r.startedAt - startedAt) / span) * 100)
    return { ...r, n: String(i + 1).padStart(2, '0'), x, w: Math.max(1, Math.min(100 - x, pct((Math.max(0, r.durationMs) / span) * 100))) }
  })
  return {
    messageId: m.id,
    runId: m.runId,
    agent: m.agentName,
    status,
    startedAt,
    endedAt,
    elapsedMs: Math.max(0, end - startedAt),
    waitingMs: approval ? Math.max(0, now - approval.since) : 0,
    steps,
    doneSteps: steps.filter((s) => s.state === 'done').length,
    files: deriveFiles(m.parts),
    approval,
  }
}

function lastTime(m: ChatMessageView): number | undefined {
  let t: number | undefined
  for (const p of m.parts) {
    const c = (p.type === 'tool-call' || p.type === 'reasoning') ? p.timing?.completedAt : undefined
    if (c !== undefined && (t === undefined || c > t)) t = c
  }
  return t
}

/** Status label and tone for the run header. */
export function statusLabel(status: InspectorRunStatus): { text: string; tone: 'warning' | 'success' | 'danger' | 'muted' | 'info' } {
  switch (status) {
    case 'waiting':
      return { text: 'awaiting approval', tone: 'warning' }
    case 'running':
      return { text: 'running', tone: 'info' }
    case 'completed':
      return { text: 'done', tone: 'success' }
    case 'cancelled':
      return { text: 'stopped', tone: 'muted' }
    default:
      return { text: 'failed', tone: 'danger' }
  }
}
