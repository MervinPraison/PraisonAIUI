/**
 * An explained approval (Pro "Allow Researcher to install a package?"):
 * what the agent wants, why it is asked, the exact call, and two choices.
 * Over the `approvals` feed's ApprovalItem shape; the frame wires the
 * buttons to ApprovalsFeed.approve / deny.
 */
import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ApprovalItem } from '@/sdk/layoutTypes'
import { cn } from '@/lib/utils'
import { describeCall } from './format'
import type { KitSize } from './rows'

export interface ApprovalCardProps {
  item: ApprovalItem
  onApprove(): Promise<void> | void
  onDeny(): Promise<void> | void
  size?: KitSize
  className?: string
}

export function ApprovalCard({ item, onApprove, onDeny, size = 'default', className }: ApprovalCardProps) {
  const [busy, setBusy] = useState(false)
  const agent = item.agentName || 'The agent'
  const headingId = `aiui-approval-${item.id}-h`
  const run = (fn: () => Promise<void> | void) => async () => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }
  const touch = size === 'touch'
  return (
    <section
      role="group"
      aria-labelledby={headingId}
      data-aiui-approval={item.id}
      className={cn('flex flex-col gap-3 rounded-xl border border-warning/40 bg-card p-3.5 text-card-foreground', className)}
    >
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning">
          <ShieldAlert className="size-4" />
        </span>
        <h2 id={headingId} className={cn('m-0 font-semibold leading-snug', touch ? 'text-base' : 'text-[15px]')}>
          Allow {agent} to use {item.toolName || 'a tool'}?
        </h2>
      </div>
      {item.description && <p className={cn('m-0 text-muted-foreground', touch ? 'text-[15px]' : 'text-sm')}>{item.description}</p>}
      <code className="block overflow-x-auto rounded-lg bg-muted px-2.5 py-2 font-mono text-[13px] whitespace-pre-wrap break-words">
        {describeCall(item)}
      </code>
      {item.riskLevel && <p className="m-0 text-xs text-muted-foreground">Risk: {item.riskLevel}</p>}
      <div className="flex gap-2">
        <Button variant="outline" size={touch ? 'lg' : 'default'} className={cn('flex-1', touch && 'h-11')} disabled={busy} onClick={run(onDeny)}>
          Not now
        </Button>
        <Button size={touch ? 'lg' : 'default'} className={cn('flex-1', touch && 'h-11')} disabled={busy} onClick={run(onApprove)}>
          Approve
        </Button>
      </div>
    </section>
  )
}
