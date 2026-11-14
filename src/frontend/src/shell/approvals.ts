/**
 * Approval notifications. In the app shell the legacy runtime runs with
 * approvalUi 'event-only' (WP4): its approval stream still dispatches
 * `aiui:approval-required` but never opens the legacy modal. The shell turns
 * each event into a toast with a "Review" action that opens the approvals
 * page, except while the chat page is on screen, where the React chat shows
 * the gate in the thread.
 */
import { useEffect } from 'react'
import { notify } from '@/sdk/notify'
import { getPageId, navigate } from './router'

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
 * Show approval toasts while mounted. `hasApprovalsPage` controls whether the
 * toast offers the "Review" action.
 */
export function useApprovalToasts(hasApprovalsPage: boolean): void {
  useEffect(() => {
    const seen = new Set<string>()
    const onApproval = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail
      if (!detail || typeof detail !== 'object') return
      const current = getPageId()
      if (current === CHAT_PAGE) return
      const d = detail as ApprovalDetail
      const key = approvalKey(d)
      if (key) {
        if (seen.has(key)) return
        seen.add(key)
      }
      const { title, description } = describeApproval(d)
      void notify(title, {
        id: key ? `aiui-approval-${key}` : undefined,
        type: 'warning',
        description: description || undefined,
        duration: 15000,
        action:
          hasApprovalsPage && current !== APPROVALS_PAGE
            ? { label: 'Review', onClick: () => navigate(APPROVALS_PAGE) }
            : undefined,
      })
    }
    window.addEventListener(APPROVAL_EVENT, onApproval)
    return () => window.removeEventListener(APPROVAL_EVENT, onApproval)
  }, [hasApprovalsPage])
}
