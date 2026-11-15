/**
 * Data a layout frame reads (ADR 0003 §1.1): the feeds first-party plugins
 * provide with provideLayoutData() and frames read with useLayoutData().
 *
 * FROZEN CONTRACT: change only additively. Types only: no runtime code, and
 * no import of chat-engine or any feature. These are structural shapes; the
 * providers (builtin.chat, builtin.approvals, builtin.runs, the artifacts
 * feature) map their own state onto them.
 */

// ── feeds ────────────────────────────────────────────────────────────

/**
 * A value that changes over time, ready for `useSyncExternalStore(f.subscribe,
 * f.get)`. `get()` returns the same object until the value changes.
 */
export interface Feed<S> {
  get(): S
  /** Call `fn` after every change. Returns the unsubscribe function. */
  subscribe(fn: () => void): () => void
}

// ── sessions ─────────────────────────────────────────────────────────

export interface SessionSummary {
  id: string
  title: string
  /** True when the server had no title and `title` is a fallback. */
  untitled?: boolean
  agent?: string
  platform?: string
  /** Epoch milliseconds. */
  updatedAt?: number
}

export interface SessionsState {
  sessions: readonly SessionSummary[]
  activeId: string | null
  runningIds: ReadonlySet<string>
  loading: boolean
  error?: string
}

export interface SessionsFeed extends Feed<SessionsState> {
  /** Open a session (null: a new, empty chat). */
  select(id: string | null): void
  /** Start a new chat. */
  create(): void
  rename(id: string, title: string): Promise<void>
  remove(id: string): Promise<void>
  refresh(): Promise<void>
}

// ── chat ─────────────────────────────────────────────────────────────

export interface ChatTiming {
  /** Epoch milliseconds. */
  startedAt: number
  completedAt?: number
}

export interface ChatTextPartView {
  type: 'text'
  id: string
  text: string
}

export interface ChatReasoningPartView {
  type: 'reasoning'
  id: string
  text: string
  done: boolean
  timing?: ChatTiming
}

export interface ChatToolPartView {
  type: 'tool-call'
  id: string
  toolName: string
  args: Readonly<Record<string, unknown>>
  result?: unknown
  isError?: boolean
  /** UI hints from the server: label, description, icon, step_number, risk_level, run_id… */
  artifact: Readonly<Record<string, unknown>>
  timing?: ChatTiming
  /** Set while the call waits for a decision (or after one). */
  approval?: {
    id: string
    prompt?: string
    display?: 'decision' | 'select' | 'text'
    allowFreeform?: boolean
    options?: readonly { id: string; kind: string; label?: string }[]
    approved?: boolean
    optionId?: string
    text?: string
  }
}

/** Rendered by named components (`element`, `a2ui`, `references`, `memory`…). */
export interface ChatDataPartView {
  type: 'data'
  id: string
  name: string
  data: unknown
}

export type ChatPartView = ChatTextPartView | ChatReasoningPartView | ChatToolPartView | ChatDataPartView

export type ChatMessageStatus =
  | { type: 'running' }
  | { type: 'requires-action'; reason: 'interrupt' | 'tool-calls' }
  | { type: 'complete' }
  | { type: 'incomplete'; reason: 'cancelled' | 'error'; error?: string }

export interface ChatMessageView {
  id: string
  role: 'user' | 'assistant' | 'system'
  parts: readonly ChatPartView[]
  /** Epoch milliseconds. */
  createdAt: number
  /** Epoch milliseconds, once an assistant message is final. */
  completedAt?: number
  status?: ChatMessageStatus
  runId?: string
  agentName?: string
  /** Extra per-message data: platform, feedback, `suggestions`… */
  custom?: Readonly<Record<string, unknown>>
}

export interface ChatState {
  sessionId: string | null
  messages: readonly ChatMessageView[]
  isRunning: boolean
  activeRunId?: string
}

export interface ChatFeed extends Feed<ChatState> {
  /** Put `text` in the composer (it is not sent). */
  prefill(text: string): void
  /** Stop the running reply. */
  cancel(): Promise<void>
  /**
   * Decide an approval gate shown in the thread. `always` asks the server to
   * remember an approval for this tool (approval gates only).
   */
  resolveApproval(
    approvalId: string,
    approved: boolean,
    opts?: { text?: string; optionId?: string; always?: boolean },
  ): Promise<void>
}

// ── approvals ────────────────────────────────────────────────────────

export interface ApprovalItem {
  id: string
  toolName?: string
  agentName?: string
  sessionId?: string
  riskLevel?: string
  description?: string
  args?: Readonly<Record<string, unknown>>
  /** Epoch milliseconds. */
  createdAt?: number
}

export interface ApprovalsState {
  pending: readonly ApprovalItem[]
}

export interface ApprovalsFeed extends Feed<ApprovalsState> {
  /** `always`: also allow this tool from now on. */
  approve(id: string, opts?: { always?: boolean }): Promise<void>
  deny(id: string, reason?: string): Promise<void>
}

// ── runs ─────────────────────────────────────────────────────────────

export type RunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'

export interface RunSummary {
  id: string
  sessionId?: string
  agent?: string
  /** Epoch milliseconds. */
  startedAt: number
  endedAt?: number
  status: RunStatus
  stepCount?: number
  tokens?: number
  /** US dollars. */
  cost?: number
  /** True when tokens and cost were joined by time window, not by run id. */
  approximate?: boolean
}

export interface RunStep {
  id: string
  kind: 'reasoning' | 'tool' | 'text' | 'approval' | 'handoff'
  label: string
  /** Epoch milliseconds. */
  startedAt?: number
  endedAt?: number
  status?: 'running' | 'done' | 'error' | 'waiting'
  toolName?: string
}

export interface RunDetail extends RunSummary {
  steps: readonly RunStep[]
  model?: string
  tokensIn?: number
  tokensOut?: number
}

export interface RunQuery {
  /** Only runs started after this run id. */
  after?: string
  agent?: string
  limit?: number
}

export interface RunKpis {
  window: 'today' | '24h' | '7d'
  runs: number
  /** Change against the previous window of the same length. */
  runsDelta?: number
  /** 0..1, cancelled runs excluded. */
  successRate?: number
  cost?: number
  budget?: number
  p50Ms?: number
  p95Ms?: number
}

export interface AgentStatus {
  name: string
  state: 'running' | 'waiting' | 'idle'
  elapsedMs?: number
  /** Epoch milliseconds. */
  lastRunAt?: number
  model?: string
  tokensToday?: number
  costToday?: number
}

export interface RunsFeed {
  run(runId: string): Feed<RunDetail | null>
  recent(query?: RunQuery): Feed<readonly RunSummary[]>
  kpis(window: 'today' | '24h' | '7d'): Feed<RunKpis | null>
  agents(): Feed<readonly AgentStatus[]>
}

// ── artifacts ────────────────────────────────────────────────────────

export type ArtifactKind = 'code' | 'table' | 'markdown' | 'file' | 'image' | 'pdf' | 'video' | 'a2ui'

export interface Artifact {
  /** Stable within a session: a file name, a table's header signature, or kind + index. */
  key: string
  kind: ArtifactKind
  title: string
  /** 1 for the first appearance of `key`; each later turn with the same key adds one. */
  version: number
  sessionId: string | null
  messageId: string
  language?: string
  /** Text content (code, markdown, a table as markdown). */
  content?: string
  /** Media and files. */
  url?: string
  mimeType?: string
  /** Epoch milliseconds. */
  updatedAt?: number
  /** True for a version the user edited. */
  edited?: boolean
}

export interface ArtifactsFeed {
  forSession(sessionId: string | null): Feed<readonly Artifact[]>
  /** Show this artifact (a version, or the latest) in the frame's canvas. */
  open(sessionId: string, key: string, version?: number): void
}

// ── the kinds ────────────────────────────────────────────────────────

/**
 * Every data kind and its feed type. Open for declaration merging: a plugin
 * adds a kind with
 *
 *   declare module '@aiui/sdk' { interface LayoutDataMap { weather: WeatherFeed } }
 */
export interface LayoutDataMap {
  sessions: SessionsFeed
  chat: ChatFeed
  approvals: ApprovalsFeed
  runs: RunsFeed
  artifacts: ArtifactsFeed
}

export type LayoutDataKind = keyof LayoutDataMap
