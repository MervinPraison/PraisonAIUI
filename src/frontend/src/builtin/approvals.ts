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
 */
import type { BuiltinPlugin, BuiltinSdk } from './types'

export const APPROVAL_EVENT = 'aiui:approval-required'
/** Dispatched by the legacy runtime's approval stream when any request is decided. */
export const RESOLVED_EVENT = 'aiui:approval-resolved'
const PENDING_URL = '/api/approvals/pending'
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

/**
 * Listen for approval events and raise one toast per request. Returns a
 * function that stops listening. `hasApprovalsPage` controls the "Review"
 * action.
 */
export function listenForApprovals(
  sdk: Pick<BuiltinSdk, 'notify' | 'navigate' | 'getPageId' | 'dismiss' | 'fetchJson'>,
  hasApprovalsPage: boolean,
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
    if (current === CHAT_PAGE) return
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

export const approvalsBuiltin: BuiltinPlugin = {
  name: 'builtin.approvals',
  // The approvals page itself is the legacy view; this built-in renders none.
  pages: [],
  always: true,
  activate(sdk, { manifest }) {
    listenForApprovals(sdk, manifest.pages.some((p) => p.id === APPROVALS_PAGE))
  },
}
