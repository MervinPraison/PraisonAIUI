/**
 * builtin.approvals: approval notifications in the app shell.
 *
 * The legacy runtime runs with approvalUi 'event-only' (WP4): its approval
 * stream still dispatches `aiui:approval-required` but never opens the legacy
 * modal. This built-in turns each event into a toast (`notify`) with a
 * "Review" action that opens the approvals page (`navigate`), except while the
 * chat page is on screen, where the React chat shows the gate in the thread.
 *
 * It is a service, not a page: it activates whether or not the manifest lists
 * the approvals page (`always`), and offers "Review" only when it does.
 */
import { currentPageId } from './page'
import type { BuiltinPlugin, BuiltinSdk } from './types'

export const APPROVAL_EVENT = 'aiui:approval-required'
const CHAT_PAGE = 'chat'
const APPROVALS_PAGE = 'approvals'

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
  sdk: Pick<BuiltinSdk, 'notify' | 'navigate'>,
  hasApprovalsPage: boolean,
): () => void {
  const seen = new Set<string>()
  const onApproval = (e: Event) => {
    const detail = (e as CustomEvent<unknown>).detail
    if (!detail || typeof detail !== 'object') return
    const current = currentPageId()
    if (current === CHAT_PAGE) return
    const d = detail as ApprovalDetail
    const key = approvalKey(d)
    if (key) {
      if (seen.has(key)) return
      seen.add(key)
    }
    const { title, description } = describeApproval(d)
    void sdk.notify(title, {
      id: key ? `aiui-approval-${key}` : undefined,
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
  return () => window.removeEventListener(APPROVAL_EVENT, onApproval)
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
