/**
 * Open approval gates of a chat thread as approval items. A provider may
 * pause a run in the thread without listing it in /api/approvals; a page
 * that counts what waits on the viewer reads both (withChatGates). Pure,
 * over the SDK's structural types.
 */
import type { ApprovalItem, ChatMessageView } from '@/sdk/layoutTypes'

export function chatGates(messages: readonly ChatMessageView[]): ApprovalItem[] {
  const out: ApprovalItem[] = []
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    for (const p of m.parts) {
      if (p.type !== 'tool-call' || !p.approval || p.approval.approved !== undefined) continue
      const risk = p.artifact?.risk_level
      out.push({
        id: p.approval.id,
        toolName: p.toolName,
        agentName: m.agentName,
        args: p.args,
        description: p.approval.prompt,
        riskLevel: typeof risk === 'string' ? risk : undefined,
        createdAt: p.timing?.startedAt ?? m.createdAt,
      })
    }
  }
  return out
}

/** Listed approvals plus the open chat's gates the list does not hold (by id). */
export function withChatGates(pending: readonly ApprovalItem[], messages: readonly ChatMessageView[]): ApprovalItem[] {
  const ids = new Set(pending.map((p) => p.id))
  return [...pending, ...chatGates(messages).filter((g) => !ids.has(g.id))]
}
