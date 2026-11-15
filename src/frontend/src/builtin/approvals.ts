/**
 * builtin.approvals: approval notifications in the app shell.
 *
 * The legacy runtime runs with approvalUi 'event-only' (WP4): its approval
 * stream still dispatches `aiui:approval-required` but never opens the legacy
 * modal. This built-in turns each event into a toast (`notify`) with a
 * "Review" action that opens the approvals page (`navigate`), except while the
 * chat page is on screen, where the React chat shows the gate in the thread.
 * When a request is decided (`aiui:approval-resolved`, anywhere), its toast
 * is closed (`dismiss`), so no stale "Review" stays on screen.
 *
 * It is a service, not a page: it activates whether or not the manifest lists
 * the approvals page (`always`), and offers "Review" only when it does.
 *
 * Layouts (ADR 0003): it provides the `approvals` layout data feed, with its
 * own EventSource on /api/approvals/stream (a layout with no legacy page never
 * loads the legacy runtime and its stream), open only while a frame
 * subscribes. While the active layout says `meta.approvals: 'frame'` the frame
 * shows pending approvals itself, so no toast is raised.
 */
import { getActiveLayout } from '@/sdk/layouts'
import type { ApprovalItem, ApprovalsFeed, ApprovalsState } from '@/sdk/layoutTypes'
import type { BuiltinPlugin, BuiltinSdk } from './types'

export const APPROVAL_EVENT = 'aiui:approval-required'
/** Dispatched by the legacy runtime's approval stream when any request is decided. */
export const RESOLVED_EVENT = 'aiui:approval-resolved'
const PENDING_URL = '/api/approvals/pending'
const STREAM_URL = '/api/approvals/stream'
const CHAT_PAGE = 'chat'
const APPROVALS_PAGE = 'approvals'

const toastId = (key: string) => `aiui-approval-${key}`

export interface ApprovalDetail {
  id?: string | number
  approval_id?: string | number
  tool_call_id?: string
  tool_name?: string
  agent_name?: string
  risk_level?: string
  description?: string
  session_id?: string
  arguments?: Record<string, unknown>
  /** Epoch seconds (the server's time.time()). */
  created_at?: number
}

function text(v: unknown, max = 160): string {
  if (typeof v !== 'string' && typeof v !== 'number') return ''
  const s = String(v).trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Stable identity of an approval, used to show one toast per request. */
export function approvalKey(d: ApprovalDetail): string {
  return text(d.id ?? d.approval_id ?? d.tool_call_id ?? '', 200)
}

/** Toast title + description for an approval event. */
export function describeApproval(d: ApprovalDetail): { title: string; description: string } {
  const tool = text(d.tool_name, 80)
  const meta = [
    d.agent_name ? `Agent ${text(d.agent_name, 60)}` : '',
    d.risk_level ? `${text(d.risk_level, 20)} risk` : '',
  ].filter(Boolean)
  return {
    title: tool ? `Approval needed: ${tool}` : 'Approval needed',
    description: [meta.join(' · '), text(d.description)].filter(Boolean).join(' — '),
  }
}

/** True while the active layout shows pending approvals itself (`meta.approvals: 'frame'`). */
export const layoutShowsApprovals = (): boolean => getActiveLayout()?.meta.approvals === 'frame'

/**
 * Listen for approval events and raise one toast per request. Returns a
 * function that stops listening. `hasApprovalsPage` controls the "Review"
 * action; no toast is raised while `framed()` (the layout shows them).
 */
export function listenForApprovals(
  sdk: Pick<BuiltinSdk, 'notify' | 'navigate' | 'getPageId' | 'dismiss' | 'fetchJson'>,
  hasApprovalsPage: boolean,
  framed: () => boolean = layoutShowsApprovals,
): () => void {
  const seen = new Set<string>()
  // Keys whose toast may still be on screen.
  const shown = new Set<string>()
  const close = (key: string) => {
    shown.delete(key)
    void sdk.dismiss(toastId(key))
  }
  // `aiui:approval-resolved` carries no id (the stream sends `{}`): ask which
  // requests are still pending and close the toasts of the others.
  let checking: Promise<void> | null = null
  let again = false
  const onResolved = (e: Event) => {
    if (shown.size === 0) return
    const resolvedKey = approvalKey(((e as CustomEvent<unknown>).detail ?? {}) as ApprovalDetail)
    if (resolvedKey) {
      if (shown.has(resolvedKey)) close(resolvedKey)
      return
    }
    if (checking) {
      again = true
      return
    }
    checking = sdk
      .fetchJson<{ approvals?: ApprovalDetail[] }>(PENDING_URL)
      .then((body) => {
        const pending = new Set((Array.isArray(body?.approvals) ? body.approvals : []).map(approvalKey))
        for (const key of [...shown]) if (!pending.has(key)) close(key)
      })
      .catch((err: unknown) => console.warn('[aiui] could not refresh pending approvals', err))
      .finally(() => {
        checking = null
        if (again) {
          again = false
          onResolved(new CustomEvent(RESOLVED_EVENT, { detail: {} }))
        }
      })
  }
  const onApproval = (e: Event) => {
    const detail = (e as CustomEvent<unknown>).detail
    if (!detail || typeof detail !== 'object') return
    const current = sdk.getPageId()
    if (current === CHAT_PAGE || framed()) return
    const d = detail as ApprovalDetail
    const key = approvalKey(d)
    if (key) {
      if (seen.has(key)) return
      seen.add(key)
    }
    const { title, description } = describeApproval(d)
    if (key) shown.add(key)
    void sdk.notify(title, {
      id: key ? toastId(key) : undefined,
      type: 'warning',
      description: description || undefined,
      duration: 15000,
      action:
        hasApprovalsPage && current !== APPROVALS_PAGE
          ? { label: 'Review', onClick: () => sdk.navigate(APPROVALS_PAGE) }
          : undefined,
    })
  }
  window.addEventListener(APPROVAL_EVENT, onApproval)
  window.addEventListener(RESOLVED_EVENT, onResolved)
  return () => {
    window.removeEventListener(APPROVAL_EVENT, onApproval)
    window.removeEventListener(RESOLVED_EVENT, onResolved)
  }
}

// ── the `approvals` layout data feed ────────────────────────────────

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

/** A pending approval record from /api/approvals/pending as an ApprovalItem (null without an id). */
export function toApprovalItem(d: ApprovalDetail): ApprovalItem | null {
  const id = approvalKey(d)
  if (!id) return null
  const at = typeof d.created_at === 'number' && Number.isFinite(d.created_at) ? d.created_at : undefined
  return {
    id,
    toolName: str(d.tool_name),
    agentName: str(d.agent_name),
    sessionId: str(d.session_id),
    riskLevel: str(d.risk_level),
    description: str(d.description),
    args: d.arguments && typeof d.arguments === 'object' && !Array.isArray(d.arguments) ? d.arguments : undefined,
    // Seconds from the server; milliseconds already are left as they are.
    createdAt: at === undefined ? undefined : at < 1e12 ? Math.round(at * 1000) : at,
  }
}

export interface ApprovalsFeedOptions {
  /** The EventSource constructor (tests; absent in old browsers: the feed polls). */
  EventSource?: typeof EventSource
  /** Poll interval when the stream is unavailable or was refused. */
  pollMs?: number
}

/**
 * The `approvals` feed. While anyone subscribes it keeps the pending list
 * from /api/approvals/pending, refreshed on every stream message (new,
 * resolved, and pings whose pending count differs), on the legacy window
 * events and after a decision made here; when the stream cannot be opened
 * or is refused it polls instead. The last unsubscribe closes the stream,
 * timers and listeners (a layout switch unmounts the frame).
 */
export function createApprovalsFeed(
  sdk: Pick<BuiltinSdk, 'fetchJson'>,
  { EventSource: ES = globalThis.EventSource, pollMs = 15_000 }: ApprovalsFeedOptions = {},
): ApprovalsFeed {
  let state: ApprovalsState = { pending: [] }
  let signature = ''
  const listeners = new Set<() => void>()
  let source: EventSource | null = null
  let poll: ReturnType<typeof setInterval> | null = null
  let loading: Promise<void> | null = null
  let again = false

  const set = (pending: ApprovalItem[]) => {
    const next = JSON.stringify(pending)
    if (next === signature) return
    signature = next
    state = { pending }
    for (const fn of [...listeners]) fn()
  }
  const refresh = (): Promise<void> => {
    if (loading) {
      again = true
      return loading
    }
    loading = sdk
      .fetchJson<{ approvals?: ApprovalDetail[] }>(PENDING_URL)
      .then((body) => {
        const items: ApprovalItem[] = []
        const keys = new Set<string>()
        for (const d of Array.isArray(body?.approvals) ? body.approvals : []) {
          const item = d && typeof d === 'object' ? toApprovalItem(d) : null
          if (item && !keys.has(item.id)) {
            keys.add(item.id)
            items.push(item)
          }
        }
        if (listeners.size) set(items)
      })
      .catch((err: unknown) => console.warn('[aiui] could not load pending approvals', err))
      .finally(() => {
        loading = null
        if (again && listeners.size) {
          again = false
          void refresh()
        }
      })
    return loading
  }
  const startPolling = () => {
    poll ??= setInterval(() => void refresh(), pollMs)
  }
  const onMessage = (e: MessageEvent) => {
    let msg: { event?: string; pending?: number } = {}
    try {
      msg = JSON.parse(String(e.data))
    } catch {
      return
    }
    if (msg.event === 'ping' && msg.pending === state.pending.length) return
    void refresh()
  }
  const onWindowEvent = () => void refresh()
  const open = () => {
    void refresh()
    window.addEventListener(APPROVAL_EVENT, onWindowEvent)
    window.addEventListener(RESOLVED_EVENT, onWindowEvent)
    if (typeof ES !== 'function') {
      startPolling()
      return
    }
    try {
      source = new ES(STREAM_URL)
    } catch {
      startPolling()
      return
    }
    source.onmessage = onMessage
    // The browser reconnects a dropped stream by itself; a refused one (401,
    // 404) ends CLOSED, and the feed polls instead.
    source.onerror = () => {
      if (source?.readyState === 2) startPolling()
    }
  }
  const close = () => {
    source?.close()
    source = null
    if (poll) clearInterval(poll)
    poll = null
    window.removeEventListener(APPROVAL_EVENT, onWindowEvent)
    window.removeEventListener(RESOLVED_EVENT, onWindowEvent)
  }
  const decide = async (id: string, approved: boolean, body: Record<string, unknown>) => {
    await sdk.fetchJson(`/api/approvals/${encodeURIComponent(id)}/${approved ? 'approve' : 'deny'}`, { method: 'POST', body })
    set(state.pending.filter((p) => p.id !== id))
    // Closes this request's toast and lets the chat and the legacy views catch up.
    window.dispatchEvent(new CustomEvent(RESOLVED_EVENT, { detail: { id } }))
  }

  return {
    get: () => state,
    subscribe(fn) {
      listeners.add(fn)
      if (listeners.size === 1) open()
      return () => {
        if (!listeners.delete(fn) || listeners.size) return
        close()
      }
    },
    approve: (id, opts = {}) => decide(id, true, { always: opts.always === true }),
    deny: (id, reason = '') => decide(id, false, { reason }),
  }
}

export const approvalsBuiltin: BuiltinPlugin = {
  name: 'builtin.approvals',
  // The approvals page itself is the legacy view; this built-in renders none.
  pages: [],
  always: true,
  activate(sdk, { manifest }) {
    listenForApprovals(sdk, manifest.pages.some((p) => p.id === APPROVALS_PAGE))
    sdk.provideLayoutData('approvals', createApprovalsFeed(sdk))
  },
}
