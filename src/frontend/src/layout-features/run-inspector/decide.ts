/** Where the run inspector sends an approval decision (pure; RunInspector.test.tsx). */
import type { ApprovalsFeed, ChatFeed } from '@/sdk/layoutTypes'

/**
 * Where a decision goes: the open chat's gate first (with `always` when
 * asked), else the approvals feed (a gate of another tab or session).
 */
export async function routeDecision(
  chat: ChatFeed | null,
  approvals: ApprovalsFeed | null,
  id: string,
  approved: boolean,
  always: boolean,
): Promise<void> {
  const remember = approved && always
  if (chat) {
    try {
      await chat.resolveApproval(id, approved, remember ? { always: true } : undefined)
      return
    } catch (err) {
      // Not in the open chat (another tab's gate): decide it through the approvals feed.
      if (!approvals) throw err
    }
  }
  if (!approvals) return
  if (!approved) await approvals.deny(id)
  else if (remember) await approvals.approve(id, { always: true })
  else await approvals.approve(id)
}
