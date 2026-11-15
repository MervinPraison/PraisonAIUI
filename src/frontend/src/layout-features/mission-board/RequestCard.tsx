/**
 * One pending approval as Mission draws it in a list (Mission.dc.html's
 * approval request: "Needs approval · Coder wants to run a command", the
 * exact call, why it is asked, Approve / Deny). The ops overview lists
 * every pending approval with it.
 */
import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
// The kit's own module, not its index: only this board uses it, so it ships in
// lf-mission-board and the kit chunk every layout loads stays as it is.
import { describeCall } from '@/app-layouts/kit/format'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ApprovalItem, ApprovalsFeed } from '@/sdk/layoutTypes'
import { notify } from '@/sdk/notify'
import { requestTitle } from './cards'
import { formatClock } from './format'

export interface RequestCardProps {
  item: ApprovalItem
  feed: ApprovalsFeed
  now: number
  touch?: boolean
}

export function RequestCard({ item, feed, now, touch }: RequestCardProps) {
  const [busy, setBusy] = useState(false)
  const headingId = `aiui-mission-request-${item.id}`
  const decide = (approved: boolean) => async () => {
    setBusy(true)
    try {
      await (approved ? feed.approve(item.id) : feed.deny(item.id))
    } catch (err) {
      void notify(err instanceof Error ? err.message : 'Could not send the decision', { type: 'error' })
    } finally {
      setBusy(false)
    }
  }
  const size = touch ? 'lg' : 'default'
  return (
    <section
      role="group"
      aria-labelledby={headingId}
      data-aiui-approval={item.id}
      className={cn('flex flex-col gap-2.5 rounded-lg border border-[var(--ui-warning-line)] bg-card px-3.5 py-3 text-card-foreground', touch && 'rounded-xl')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-xs border border-[var(--ui-warning-line)] bg-warning-soft text-warning px-1.5 text-xs font-medium">
          <TriangleAlert aria-hidden className="size-2.5" />
          Needs approval
        </span>
        <h3 id={headingId} className={cn('m-0 font-semibold', touch ? 'text-[15px]' : 'text-sm')}>
          {requestTitle(item)}
        </h3>
        {item.createdAt && <span className="ml-auto font-mono text-xs text-tier-3">waiting {formatClock(now - item.createdAt)}</span>}
      </div>
      <pre className="m-0 overflow-x-auto rounded-md border border-hairline bg-code px-3 py-2 font-mono text-[13px] whitespace-pre-wrap break-words text-foreground">
        <code>$ {describeCall(item)}</code>
      </pre>
      {(item.description || item.riskLevel) && (
        <p className="m-0 text-[13px] text-muted-foreground">{[item.description, item.riskLevel && `${item.riskLevel} risk`].filter(Boolean).join(' · ')}</p>
      )}
      {/* Deny, then Approve: the order of MissionPhone.dc.html and of the banner. */}
      <div className="flex gap-2">
        <Button variant="outline" size={size} className={cn(touch && 'h-11 flex-1 text-[15px]')} disabled={busy} onClick={decide(false)}>
          Deny
        </Button>
        <Button size={size} className={cn(touch && 'h-11 flex-1 text-[15px]')} disabled={busy} onClick={decide(true)}>
          Approve
        </Button>
      </div>
    </section>
  )
}
