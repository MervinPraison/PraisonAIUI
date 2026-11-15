/**
 * The run timeline of one assistant turn (Mission "Think 2.0s · terminal
 * 0.3s · Answer 4.1s · Handoff → Coder · Approval pending 0:42"), derived
 * on the client from the turn's parts and their timing (pure;
 * timeline.test.ts). No server call: the chat already has every step.
 */
import type { ChatMessageView, ChatToolPartView } from '@/sdk/layoutTypes'

export type TimelineKind = 'think' | 'tool' | 'answer' | 'handoff' | 'approval'
export type TimelineStatus = 'done' | 'running' | 'waiting' | 'error'

export interface TimelineStep {
  id: string
  kind: TimelineKind
  label: string
  /** Epoch ms. */
  startedAt: number
  endedAt?: number
  status: TimelineStatus
}

const HANDOFF = /^(?:handoff|hand_off|transfer)(?:_to)?[_-]?(.*)$/i

/** The agent a handoff tool hands to: its `agent` / `agent_name` / `to` argument, else the tool name's suffix. */
function handoffTarget(part: ChatToolPartView): string | null {
  const m = HANDOFF.exec(part.toolName)
  if (!m) return null
  const args = part.args ?? {}
  for (const key of ['agent', 'agent_name', 'to', 'target']) {
    const v = args[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  const suffix = m[1].replace(/[_-]+/g, ' ').trim()
  return suffix ? suffix.replace(/\b\w/g, (c) => c.toUpperCase()) : 'another agent'
}

function isRunning(message: ChatMessageView): boolean {
  const t = message.status?.type
  return t === 'running' || t === 'requires-action'
}

/** The steps of an assistant turn in order; [] for anything else. */
export function timelineSteps(message: ChatMessageView | undefined): TimelineStep[] {
  if (!message || message.role !== 'assistant') return []
  const live = isRunning(message)
  const steps: TimelineStep[] = []
  let cursor = message.createdAt
  for (const part of message.parts) {
    if (part.type === 'reasoning') {
      const startedAt = part.timing?.startedAt ?? cursor
      const endedAt = part.timing?.completedAt ?? (part.done ? startedAt : undefined)
      steps.push({ id: part.id, kind: 'think', label: 'Think', startedAt, endedAt, status: endedAt === undefined ? 'running' : 'done' })
      cursor = endedAt ?? startedAt
    } else if (part.type === 'tool-call') {
      const startedAt = part.timing?.startedAt ?? cursor
      const gate = part.approval
      if (gate && gate.approved === undefined) {
        steps.push({ id: part.id, kind: 'approval', label: 'Approval pending', startedAt, status: 'waiting' })
        cursor = startedAt
        continue
      }
      const endedAt = part.timing?.completedAt ?? (part.result !== undefined || part.isError ? startedAt : undefined)
      const target = handoffTarget(part)
      const status: TimelineStatus = part.isError || gate?.approved === false ? 'error' : endedAt === undefined ? 'running' : 'done'
      steps.push({
        id: part.id,
        kind: target ? 'handoff' : 'tool',
        label: target ? `Handoff → ${target}` : part.toolName || 'Tool',
        startedAt,
        endedAt,
        status,
      })
      cursor = endedAt ?? startedAt
    } else if (part.type === 'text') {
      if (!part.text.trim()) continue
      const prev = steps[steps.length - 1]
      if (prev?.kind === 'answer') continue // one answer per stretch of text
      steps.push({ id: part.id, kind: 'answer', label: 'Answer', startedAt: cursor, status: 'running' })
    }
  }
  // An answer lasts until the next step starts, or until the turn ended.
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]
    if (s.kind !== 'answer') continue
    const next = steps[i + 1]
    if (next) s.endedAt = Math.max(next.startedAt, s.startedAt)
    else if (!live) s.endedAt = Math.max(message.completedAt ?? s.startedAt, s.startedAt)
    s.status = s.endedAt === undefined ? 'running' : 'done'
  }
  // While the turn waits on a gate, only the gate counts up.
  if (message.status?.type === 'requires-action') {
    const gate = steps.find((s) => s.status === 'waiting')
    for (const s of steps) {
      if (s.status !== 'running') continue
      s.status = 'done'
      s.endedAt = Math.max(s.startedAt, gate?.startedAt ?? s.startedAt)
    }
  }
  if (!live) {
    for (const s of steps) {
      if (s.status === 'running') {
        s.status = message.status?.type === 'incomplete' ? 'error' : 'done'
        s.endedAt ??= message.completedAt ?? s.startedAt
      }
    }
  }
  return steps
}

/** How long a step took, or has taken so far (running and waiting steps count up to `now`). */
export function stepMs(step: TimelineStep, now: number): number {
  return Math.max(0, (step.endedAt ?? now) - step.startedAt)
}

/** True while a step still counts up (the strip re-renders every second). */
export function isLive(steps: readonly TimelineStep[]): boolean {
  return steps.some((s) => s.endedAt === undefined)
}

/** The bar's share of the strip: proportional to time, so a 0.3 s tool still shows. */
export function stepWeight(step: TimelineStep, now: number): number {
  return Math.max(stepMs(step, now) / 1000, 0.5)
}

/** The newest assistant turn of a thread. */
export function lastAssistant(messages: readonly ChatMessageView[]): ChatMessageView | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') return messages[i]
  return undefined
}
