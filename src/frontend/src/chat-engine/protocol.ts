/**
 * chat-engine/protocol.ts — PURE reducer: AIUI wire events -> AiuiMessage parts.
 *
 * Accepts frames from BOTH transports:
 *   - SSE  POST /run            (server.py run_agent)      — ask/approval data under `extra_data`
 *   - WS   /api/chat/ws         (features/chat.py _chat_ws) — ask data top-level, carries run_id
 *
 * Newer servers (WP3) add fields; every one of them is optional here so older
 * servers keep working:
 *   - approval run_paused carries extra_data (+ top-level copies) and tool_call_id
 *   - the first run_started carries the resolved agent_name (and is sent once)
 *   - persisted cancelled replies carry status: 'cancelled'
 *
 * No React, no DOM: runs under `node --test` (scripts/run-tests.mjs).
 */

export type JSONObject = Record<string, unknown>
export type WireEvent = { type: string } & JSONObject

export type AiuiTiming = { startedAt: number; completedAt?: number }

export type AiuiTextPart = { type: 'text'; id: string; text: string }
export type AiuiReasoningPart = { type: 'reasoning'; id: string; text: string; done: boolean; timing?: AiuiTiming }
export type AiuiToolPart = {
  type: 'tool-call'
  id: string // == toolCallId
  toolName: string
  args: JSONObject
  result?: unknown
  isError?: boolean
  /**
   * UI-only: icon, description, step_number, a2ui, surface_id, formatted_result, risk_level, run_id,
   * and the client's own APPROVAL_PENDING / APPROVAL_ERROR for a decision in flight or one that failed.
   */
  artifact: JSONObject
  timing?: AiuiTiming
  approval?: {
    id: string
    prompt?: string
    display?: 'decision' | 'select' | 'text'
    allowFreeform?: boolean
    options?: { id: string; kind: string; label?: string }[]
    approved?: boolean
    optionId?: string
    text?: string
  }
}
/** Rendered by our own components (data-<name>): element, a2ui, references, memory */
export type AiuiDataPart = { type: 'data'; id: string; name: string; data: unknown }
export type AiuiPart = AiuiTextPart | AiuiReasoningPart | AiuiToolPart | AiuiDataPart

export type AiuiStatus =
  | { type: 'running' }
  | { type: 'requires-action'; reason: 'interrupt' | 'tool-calls' }
  | { type: 'complete' }
  | { type: 'incomplete'; reason: 'cancelled' | 'error'; error?: string }

export interface AiuiMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  parts: AiuiPart[]
  createdAt: number
  status?: AiuiStatus // assistant only
  runId?: string
  agentName?: string
  /** user-only: uploaded attachment descriptors */
  attachments?: { id: string; name: string; contentType: string; previewUrl?: string }[]
  /** channel/platform, feedback, transport (`via`), reconnect state, etc. */
  custom?: JSONObject
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed'

/** Out-of-message session signals (context ring, compaction, metrics, connection). */
export interface AiuiSessionSignals {
  context?: JSONObject
  compactedAt?: number
  metrics?: JSONObject
  /** Live-transport state (WS); absent for request/response transports. */
  connection?: ConnectionStatus
}

let _seq = 0
export const genId = (p = 'p') => `${p}_${Date.now().toString(36)}_${(_seq++).toString(36)}`

const s = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)
const obj = (v: unknown): JSONObject => (v && typeof v === 'object' && !Array.isArray(v) ? (v as JSONObject) : {})

export function newAssistant(runId?: string, agentName?: string): AiuiMessage {
  return { id: genId('m'), role: 'assistant', parts: [], createdAt: Date.now(), status: { type: 'running' }, runId, agentName }
}

const last = <T>(a: T[]) => a[a.length - 1]

const hasOpenGate = (m: AiuiMessage) =>
  m.parts.some((p) => p.type === 'tool-call' && p.approval && p.approval.approved === undefined)

/** A message waiting on a gate goes back to running once every gate is resolved. */
function settleGate(m: AiuiMessage): AiuiMessage {
  if (m.status?.type === 'requires-action' && !hasOpenGate(m)) return { ...m, status: { type: 'running' } }
  return m
}

function appendText(m: AiuiMessage, text: string): AiuiMessage {
  if (!text) return m
  const tail = last(m.parts)
  if (tail?.type === 'text') {
    return { ...m, parts: [...m.parts.slice(0, -1), { ...tail, text: tail.text + text }] }
  }
  // text after tools/reasoning starts a new segment, so interleaving is preserved
  return { ...m, parts: [...m.parts, { type: 'text', id: genId('t'), text }] }
}

function openReasoning(m: AiuiMessage): AiuiMessage {
  const tail = last(m.parts)
  if (tail?.type === 'reasoning' && !tail.done) return m
  return { ...m, parts: [...m.parts, { type: 'reasoning', id: genId('r'), text: '', done: false, timing: { startedAt: Date.now() } }] }
}

function appendReasoning(m: AiuiMessage, step: string): AiuiMessage {
  const opened = openReasoning(m)
  const tail = last(opened.parts) as AiuiReasoningPart
  const text = tail.text ? `${tail.text}\n- ${step}` : `- ${step}`
  return { ...opened, parts: [...opened.parts.slice(0, -1), { ...tail, text }] }
}

function closeReasoning(m: AiuiMessage): AiuiMessage {
  if (!m.parts.some((p) => p.type === 'reasoning' && !p.done)) return m
  const now = Date.now()
  return {
    ...m,
    parts: m.parts.map((p) =>
      p.type === 'reasoning' && !p.done
        ? { ...p, done: true, timing: p.timing ? { ...p.timing, completedAt: now } : undefined }
        : p,
    ),
  }
}

function elementKey(el: JSONObject): string {
  return s(el.url) ?? s(el.id) ?? s(el.path) ?? JSON.stringify(el)
}

function addElement(m: AiuiMessage, el: unknown): AiuiMessage {
  const e = obj(el)
  if (!Object.keys(e).length) return m
  const key = elementKey(e)
  // The WS path sends BOTH message_element and tool_call_completed.elements -> dedupe by url.
  if (m.parts.some((p) => p.type === 'data' && p.name === 'element' && elementKey(obj(p.data)) === key)) return m
  return { ...m, parts: [...m.parts, { type: 'data', id: `el_${key}`, name: 'element', data: e }] }
}

function upsertTool(m: AiuiMessage, ev: WireEvent, completed: boolean, now = Date.now()): AiuiMessage {
  const name = s(ev.name) ?? s(ev.tool_name) ?? 'tool'
  const id = s(ev.tool_call_id)
  // Match by id; else the newest unresolved call with the same name (hook events have no id,
  // and on older servers the approval run_paused arrives BEFORE tool_call_started without an id).
  let idx = id ? m.parts.findIndex((p) => p.type === 'tool-call' && p.id === id) : -1
  if (idx < 0) {
    for (let i = m.parts.length - 1; i >= 0; i--) {
      const p = m.parts[i]
      if (p.type === 'tool-call' && p.toolName === name && p.result === undefined && p.toolName !== 'aiui_ask') {
        idx = i
        break
      }
    }
  }
  const prev = idx >= 0 ? (m.parts[idx] as AiuiToolPart) : undefined
  const extra = obj(ev.extra_data)
  const artifact: JSONObject = { ...(prev?.artifact ?? {}) }
  for (const k of ['icon', 'label', 'description', 'step_number', 'formatted_result', 'agent_name']) {
    if (ev[k] !== undefined) artifact[k] = ev[k]
  }
  const a2ui = ev.a2ui ?? extra.a2ui
  if (Array.isArray(a2ui) && a2ui.length) {
    artifact.a2ui = a2ui
    artifact.surface_id = ev.surface_id ?? extra.surface_id ?? 'main'
  }
  const startedAt = prev?.timing?.startedAt ?? now
  const part: AiuiToolPart = {
    type: 'tool-call',
    id: prev?.id ?? id ?? genId('tc'),
    toolName: name,
    args: { ...(prev?.args ?? {}), ...obj(ev.args) },
    artifact,
    approval: prev?.approval,
    timing: completed ? { startedAt, completedAt: now } : { startedAt },
    ...(completed
      ? { result: ev.result ?? ev.formatted_result ?? null, isError: Boolean(ev.error) || undefined }
      : prev && prev.result !== undefined
        ? { result: prev.result, isError: prev.isError }
        : {}),
  }
  if (completed && part.approval && part.approval.approved === undefined) {
    part.approval = { ...part.approval, approved: true } // the tool ran, so the gate was passed
  }
  let next: AiuiMessage = {
    ...m,
    parts: idx >= 0 ? m.parts.map((p, i) => (i === idx ? part : p)) : [...m.parts, part],
  }
  const els = (ev.elements ?? extra.elements) as unknown[] | undefined
  if (completed && Array.isArray(els)) for (const el of els) next = addElement(next, el)
  return settleGate(next)
}

/** Data part shown while an approval is pending that this stream could not describe (older WS servers). */
export const PENDING_APPROVAL = 'approval-pending'

/**
 * Artifact keys the store sets on a gated tool part (approval or ask) while the
 * user's decision is on its way to the server ('approve' | 'deny' | 'answer'),
 * and after the server rejected it (the message to show). They live on the part,
 * not in a component, so a gate that unmounts and mounts again still shows them.
 */
export const APPROVAL_PENDING = 'aiui_decision_pending'
export const APPROVAL_ERROR = 'aiui_decision_error'

/** The question older WS servers put on a run_paused whose extra_data they dropped. */
const LEGACY_DEFAULT_QUESTION = 'The agent needs your input'

/**
 * Older WS servers (before WP3) forward neither extra_data nor pause_type on
 * run_paused, so an approval gate arrives as a bare ask with the server's
 * default question and no options. A real ask always carries its own
 * question (possibly empty), so this shape means "approval pending".
 */
function isLegacyApprovalPause(ev: WireEvent): boolean {
  return (
    ev.extra_data === undefined &&
    ev.pause_type === undefined &&
    ev.question === LEGACY_DEFAULT_QUESTION &&
    !(Array.isArray(ev.options) && ev.options.length)
  )
}

export const hasPendingApprovalNotice = (m: AiuiMessage): boolean =>
  m.parts.some((p) => p.type === 'data' && p.name === PENDING_APPROVAL)

function approvalGate(m0: AiuiMessage, ev: WireEvent, extra: JSONObject): AiuiMessage {
  // A described gate replaces the "approval pending" placeholder.
  const m = hasPendingApprovalNotice(m0)
    ? { ...m0, parts: m0.parts.filter((p) => !(p.type === 'data' && p.name === PENDING_APPROVAL)) }
    : m0
  const approvalId = s(extra.id) ?? s(extra.approval_id) ?? genId('ap')
  // The same gate can arrive twice (top-level + extra_data copies, or a replay): keep one.
  if (m.parts.some((p) => p.type === 'tool-call' && p.approval?.id === approvalId)) return m
  const toolName = s(extra.tool_name) ?? s(ev.tool_name) ?? 'tool'
  const approval: NonNullable<AiuiToolPart['approval']> = {
    id: approvalId,
    prompt: s(extra.description) ?? `Allow ${toolName}?`,
    display: 'decision',
  }
  const status: AiuiStatus = { type: 'requires-action', reason: 'tool-calls' }
  // Newer servers correlate the gate with its tool call; older ones only give the tool name.
  const tcId = s(extra.tool_call_id) ?? s(ev.tool_call_id)
  let idx = tcId ? m.parts.findIndex((p) => p.type === 'tool-call' && p.id === tcId) : -1
  if (idx < 0 && !tcId) {
    // No id: the newest unfinished, ungated call of that tool (the gate usually
    // arrives first, and then tool_call_started merges into it by name instead).
    for (let i = m.parts.length - 1; i >= 0; i--) {
      const p = m.parts[i]
      if (p.type === 'tool-call' && p.toolName === toolName && p.result === undefined && !p.approval) {
        idx = i
        break
      }
    }
  }
  if (idx >= 0) {
    const prev = m.parts[idx] as AiuiToolPart
    const merged: AiuiToolPart = {
      ...prev,
      args: Object.keys(prev.args).length ? prev.args : obj(extra.arguments),
      artifact: { ...prev.artifact, risk_level: extra.risk_level },
      approval,
    }
    return { ...m, parts: m.parts.map((p, i) => (i === idx ? merged : p)), status }
  }
  const part: AiuiToolPart = {
    type: 'tool-call',
    id: tcId ?? `approval_${approvalId}`,
    toolName,
    args: obj(extra.arguments),
    artifact: { risk_level: extra.risk_level },
    approval,
  }
  return { ...m, parts: [...m.parts, part], status }
}

function pause(m: AiuiMessage, ev: WireEvent): AiuiMessage {
  const extra = obj(ev.extra_data)
  if (extra.type === 'approval_required') return approvalGate(m, ev, extra)
  // Newer WS servers also expose the gate kind as pause_type (extra_data.type is the source of truth).
  if (ev.pause_type === 'approval_required') return approvalGate(m, ev, { ...extra, ...ev, type: 'approval_required' })
  if (isLegacyApprovalPause(ev)) {
    if (hasPendingApprovalNotice(m)) return m
    const part: AiuiDataPart = { type: 'data', id: genId('pending'), name: PENDING_APPROVAL, data: { tool_name: s(ev.tool_name) } }
    return { ...m, parts: [...m.parts, part] }
  }
  // ask_user (human input). SSE: extra_data.{question,options}; WS: top-level.
  const question = s(ev.question) ?? s(extra.question) ?? 'The agent needs your input'
  const rawOpts = (Array.isArray(ev.options) && ev.options.length ? ev.options : extra.options ?? []) as unknown[]
  const options = (Array.isArray(rawOpts) ? rawOpts : []).map((o, i) => {
    const label = typeof o === 'string' ? o : s(obj(o).label) ?? s(obj(o).value) ?? String(o)
    return { id: `opt_${i}`, kind: '_answer', label }
  })
  const runId = s(ev.run_id) ?? m.runId
  const askId = `ask_${runId ?? genId('ask')}_${m.parts.length}`
  const part: AiuiToolPart = {
    type: 'tool-call',
    id: askId,
    toolName: 'aiui_ask',
    args: { question, options: options.map((o) => o.label) },
    artifact: { run_id: runId },
    approval: {
      id: askId,
      prompt: question,
      display: options.length ? 'select' : 'text',
      allowFreeform: !options.length,
      options: options.length ? options : undefined,
    },
  }
  return { ...m, parts: [...m.parts, part], status: { type: 'requires-action', reason: 'interrupt' } }
}

function finalize(m: AiuiMessage, content: string | undefined): AiuiMessage {
  let next = closeReasoning(m)
  if (content && content !== 'None') {
    const streamed = next.parts.filter((p): p is AiuiTextPart => p.type === 'text').map((p) => p.text).join('')
    if (streamed.trim() !== content.trim()) {
      // Server semantics: the final content REPLACES the accumulated tokens.
      next = { ...next, parts: [...next.parts.filter((p) => p.type !== 'text'), { type: 'text', id: genId('t'), text: content }] }
    }
  }
  return { ...next, status: hasOpenGate(next) ? next.status : { type: 'complete' } }
}

/**
 * Apply one wire event to the in-flight assistant message.
 * Returns the new message plus optional session-level signals.
 */
export function applyEvent(
  m0: AiuiMessage,
  ev: WireEvent,
): { message: AiuiMessage; signals?: Partial<AiuiSessionSignals> } {
  const t = ev.type
  // The run moved past an undescribed approval (it was decided elsewhere): drop the placeholder.
  const m = CLEARS_PENDING_APPROVAL.has(t) && hasPendingApprovalNotice(m0)
    ? { ...m0, parts: m0.parts.filter((p) => !(p.type === 'data' && p.name === PENDING_APPROVAL)) }
    : m0
  switch (t) {
    case 'run_started':
    case 'team_run_started':
      // Older WS servers emit run_started twice (chat.py broadcast + provider) -> idempotent.
      return { message: { ...m, runId: s(ev.run_id) ?? m.runId, agentName: s(ev.agent_name) ?? m.agentName } }
    case 'token':
    case 'run_content':
    case 'team_run_content': {
      const tok = s(ev.token) ?? (ev.token == null ? s(ev.content) : undefined) ?? ''
      let out = settleGate(appendText(closeReasoning(m), tok === 'None' ? '' : tok))
      // When run_started named no agent (WP3 sends the resolved name only if it knows it), the stream does.
      if (!out.agentName && s(ev.agent_name)) out = { ...out, agentName: s(ev.agent_name) }
      return { message: out, signals: ev.metrics ? { metrics: obj(ev.metrics) } : undefined }
    }
    case 'llm_content':
      return { message: appendText(closeReasoning(m), (s(ev.content) ?? '') + '\n\n') }
    case 'reasoning_started':
    case 'team_reasoning_started':
      return { message: openReasoning(m) }
    case 'thinking':
    case 'reasoning_step':
    case 'team_reasoning_step':
      return { message: s(ev.step) ? appendReasoning(m, s(ev.step)!) : m }
    case 'reasoning_completed':
    case 'team_reasoning_completed':
      return { message: closeReasoning(m) }
    case 'tool_call':
    case 'tool_call_started':
    case 'team_tool_call_started':
      return { message: upsertTool(closeReasoning(m), ev, false) }
    case 'tool_call_completed':
    case 'team_tool_call_completed':
      return { message: upsertTool(m, ev, true) }
    case 'message_element':
      return { message: addElement(m, ev.element ?? obj(ev.extra_data).element) }
    case 'a2ui_surface':
      return {
        message: {
          ...m,
          parts: [...m.parts, { type: 'data', id: genId('a2ui'), name: 'a2ui', data: { surface_id: ev.surface_id ?? 'main', messages: ev.messages ?? [] } }],
        },
      }
    case 'references': {
      const refs = (ev.references ?? obj(ev.extra_data).references ?? []) as unknown[]
      if (!Array.isArray(refs) || !refs.length) return { message: m } // older WS servers drop the payload
      return { message: { ...m, parts: [...m.parts, { type: 'data', id: genId('ref'), name: 'references', data: { query: ev.query, references: refs } }] } }
    }
    case 'memory_update_started':
    case 'team_memory_update_started':
      return { message: { ...m, parts: [...m.parts.filter((p) => !(p.type === 'data' && p.name === 'memory')), { type: 'data', id: 'memory', name: 'memory', data: { status: 'running' } }] } }
    case 'memory_update_completed':
    case 'team_memory_update_completed':
      return { message: { ...m, parts: m.parts.map((p) => (p.type === 'data' && p.name === 'memory' ? { ...p, data: { status: 'done' } } : p)) } }
    case 'run_paused':
      return { message: pause(m, ev) }
    case 'approval_required':
      return { message: pause(m, { ...ev, extra_data: { ...obj(ev.extra_data), ...ev, type: 'approval_required' } }) }
    case 'message':
    case 'run_completed':
    case 'team_run_completed':
      return { message: finalize(m, s(ev.content)) }
    case 'error':
    case 'run_error':
    case 'team_run_error':
      return { message: { ...closeReasoning(m), status: { type: 'incomplete', reason: 'error', error: s(ev.error) ?? s(ev.message) ?? 'Unknown error' } } }
    case 'run_cancelled':
    case 'team_run_cancelled':
      return { message: { ...closeReasoning(m), status: { type: 'incomplete', reason: 'cancelled' } } }
    case 'end':
    case 'done':
      return { message: m.status?.type === 'running' ? finalize(m, undefined) : m }
    case 'context_update':
      return { message: m, signals: { context: ev } }
    case 'context_compacted':
      return { message: m, signals: { compactedAt: Date.now() } }
    default:
      return { message: m }
  }
}

/**
 * Events that show the run continued after an approval pause. tool_call_started
 * is not one: the provider emits it right after the pause, before the decision.
 */
const CLEARS_PENDING_APPROVAL = new Set([
  'token', 'run_content', 'team_run_content', 'llm_content',
  'tool_call_completed', 'team_tool_call_completed',
  'message', 'run_completed', 'team_run_completed',
  'error', 'run_error', 'team_run_error', 'run_cancelled', 'team_run_cancelled', 'end', 'done',
])

/** Events that terminate a run (the transport closes the turn). */
export const TERMINAL = new Set([
  'run_completed', 'team_run_completed', 'run_error', 'team_run_error', 'error',
  'run_cancelled', 'team_run_cancelled', 'end', 'done',
])

function historyStatus(raw: JSONObject): AiuiStatus {
  const st = s(raw.status)
  if (st === 'cancelled' || st === 'canceled' || raw.cancelled === true) return { type: 'incomplete', reason: 'cancelled' }
  if (st === 'error') return { type: 'incomplete', reason: 'error', error: s(raw.error) }
  return { type: 'complete' }
}

/**
 * A saved user message's files, `[{id, name, content_type}]` (the server keeps
 * an unknown id with the id alone). A reloaded thread shows them, and
 * Regenerate (popLastTurn) resends their ids.
 */
function historyAttachments(raw: unknown): NonNullable<AiuiMessage['attachments']> {
  if (!Array.isArray(raw)) return []
  const out: NonNullable<AiuiMessage['attachments']> = []
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue
    const att = a as JSONObject
    const id = s(att.id)
    if (!id) continue
    out.push({ id, name: s(att.name) ?? id, contentType: s(att.content_type) ?? s(att.contentType) ?? 'application/octet-stream' })
  }
  return out
}

/** Rehydrate a persisted message from /api/chat/history or /sessions/{id}/runs. */
export function fromHistory(raw: JSONObject, i: number): AiuiMessage {
  const role = (s(raw.role) as AiuiMessage['role']) ?? 'user'
  let m: AiuiMessage = {
    id: s(raw.id) ?? s(raw.message_id) ?? `h_${i}`,
    role,
    parts: [],
    createdAt: Date.parse(s(raw.timestamp) ?? s(raw.created_at) ?? '') || Date.now(),
    agentName: s(raw.agent_name),
    custom: raw.platform ? { platform: raw.platform, icon: raw.icon } : undefined,
  }
  if (role === 'assistant') {
    m.status = historyStatus(raw)
    for (const tc of (raw.toolCalls as JSONObject[] | undefined) ?? []) {
      m = upsertTool(m, { ...tc, type: 'tool_call_completed' } as WireEvent, true, 0)
      // persisted calls carry no wall-clock timing worth showing
      m = { ...m, parts: m.parts.map((p) => (p.type === 'tool-call' ? { ...p, timing: undefined } : p)) }
    }
    for (const el of (raw.elements as unknown[] | undefined) ?? []) m = addElement(m, el)
  } else if (role === 'user') {
    const attachments = historyAttachments(raw.attachments)
    if (attachments.length) m.attachments = attachments
  }
  const content = s(raw.content) ?? s(raw.message) ?? ''
  if (content) m = { ...m, parts: [...m.parts, { type: 'text', id: `${m.id}_t`, text: content }] }
  return m
}

/**
 * Merge a persisted assistant reply into a live message whose stream was cut
 * (WS reconnect): completes tool calls that finished while offline, adds
 * elements, and takes the persisted text as final.
 */
export function reconcileFromHistory(m: AiuiMessage, raw: JSONObject): AiuiMessage {
  let next = m
  for (const tc of (raw.toolCalls as JSONObject[] | undefined) ?? []) {
    next = upsertTool(next, { ...tc, type: 'tool_call_completed' } as WireEvent, true)
  }
  for (const el of (raw.elements as unknown[] | undefined) ?? []) next = addElement(next, el)
  next = finalize(next, s(raw.content))
  const st = historyStatus(raw)
  return st.type === 'complete' ? next : { ...next, status: st }
}
