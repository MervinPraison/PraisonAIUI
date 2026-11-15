/**
 * The approval banner Mission shows on every page while an approval waits
 * (Mission.dc.html "Coder needs your approval to continue this run"): who
 * asks, the exact call, how long it has waited, Review / Deny / Approve.
 *
 * The default export (AttentionBanner) picks what to show: the oldest
 * pending approval of the approvals feed (not on the approvals page), else
 * a gate waiting in the open chat's thread (not on the chat page, where the
 * thread shows it). The frame loads it with import().
 */
import { useState, type Ref } from 'react'
import { TriangleAlert } from 'lucide-react'
// The kit's own module, not its index: only this board uses it, so it ships in
// lf-mission-board and the kit chunk every layout loads stays as it is.
import { describeCall } from '@/app-layouts/kit/format'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ApprovalItem } from '@/sdk/layoutTypes'
import { notify } from '@/sdk/notify'
import { attention } from './agents'
import { approvalTitle } from './cards'
import { formatClock } from './format'
import { useApprovals, useChat, useNow } from './hooks'

export interface ApprovalBannerProps {
  item: ApprovalItem
  /** How many others wait behind this one. */
  more: number
  /** Send the decision (the approvals feed, or the open chat for a gate in its thread). */
  decide(approved: boolean): Promise<void>
  /** Label of the review link ("Review", "Open chat"). */
  reviewLabel?: string
  touch?: boolean
  /** Open the approvals page (absent: no Review link). */
  onReview?(): void
  /** The Approve button (the frame's mod+j moves focus to it). */
  approveRef?: Ref<HTMLButtonElement>
  className?: string
}

export function ApprovalBanner({ item, more, decide: send, reviewLabel = 'Review', touch, onReview, approveRef, className }: ApprovalBannerProps) {
  const [busy, setBusy] = useState(false)
  const now = useNow(!!item.createdAt)
  const decide = (approved: boolean) => async () => {
    setBusy(true)
    try {
      await send(approved)
    } catch (err) {
      void notify(err instanceof Error ? err.message : 'Could not send the decision', { type: 'error' })
    } finally {
      setBusy(false)
    }
  }
  const call = describeCall(item)
  const waiting = item.createdAt ? formatClock(now - item.createdAt) : null
  return (
    <div
      role="alert"
      data-aiui-approval-banner={item.id}
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg border border-[var(--ui-warning-line)] bg-warning-soft px-3 py-2.5',
        touch && 'flex-col items-stretch rounded-xl p-3',
        className,
      )}
    >
      <div className={cn('flex min-w-0 gap-2.5', !touch && 'flex-[1_1_260px]')}>
        <span aria-hidden="true" className={cn('flex shrink-0 items-center justify-center rounded-md bg-warning text-warning-foreground', touch ? 'size-8' : 'size-7')}>
          <TriangleAlert className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-px">
          <span className={cn('font-semibold text-foreground', touch ? 'text-[15px]' : 'text-sm')}>{approvalTitle(item)}</span>
          <span className="min-w-0 text-[13px] text-muted-foreground">
            Wants to run <code className="font-mono break-all text-foreground">{call.length > 120 ? `${call.slice(0, 119)}…` : call}</code>
            {item.riskLevel && ` · ${item.riskLevel} risk`}
            {waiting && (
              <>
                {' · waiting '}
                <span className="font-mono">{waiting}</span>
              </>
            )}
            {more > 0 && ` · ${more} more waiting`}
          </span>
        </div>
      </div>
      <div className={cn('flex items-center gap-1.5', touch && 'gap-2')}>
        {onReview && !touch && (
          <Button variant="link" size="sm" onClick={onReview}>
            {reviewLabel}
          </Button>
        )}
        <Button
          variant="outline"
          size={touch ? 'lg' : 'sm'}
          className={cn('bg-card', touch && 'h-11 flex-1 text-[15px]')}
          disabled={busy}
          onClick={decide(false)}
        >
          Deny
        </Button>
        <Button ref={approveRef} size={touch ? 'lg' : 'sm'} className={cn(touch && 'h-11 flex-1 text-[15px]')} disabled={busy} onClick={decide(true)}>
          Approve
        </Button>
      </div>
    </div>
  )
}

export interface AttentionBannerProps {
  /** The routed page (no banner for what that page already shows). */
  pageId: string
  approvalsPage: string
  chatPage: string
  touch?: boolean
  /** Open a page (Review: the approvals page; a chat gate: the chat). */
  go(pageId: string): void
  /** Whether the approvals page is listed (otherwise no Review link). */
  canReview: boolean
  approveRef?: Ref<HTMLButtonElement>
  className?: string
}

export default function AttentionBanner({ pageId, approvalsPage, chatPage, touch, go, canReview, approveRef, className }: AttentionBannerProps) {
  const approvals = useApprovals()
  const chat = useChat()
  const pick = attention(approvals.feed ? approvals.pending : [], chat.state.messages, { onApprovals: pageId === approvalsPage, onChat: pageId === chatPage })
  if (!pick) return null
  const { item, source, more } = pick
  const decide =
    source === 'chat'
      ? (approved: boolean) => chat.feed!.resolveApproval(item.id, approved)
      : (approved: boolean) => (approved ? approvals.feed!.approve(item.id) : approvals.feed!.deny(item.id))
  return (
    <ApprovalBanner
      item={item}
      more={more}
      decide={decide}
      touch={touch}
      reviewLabel={source === 'chat' ? 'Open chat' : 'Review'}
      onReview={source === 'chat' ? () => go(chatPage) : canReview ? () => go(approvalsPage) : undefined}
      approveRef={approveRef}
      className={className}
    />
  )
}
