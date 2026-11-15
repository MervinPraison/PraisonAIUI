/**
 * The keyboard approval strip (`meta.chat.approvals: 'keyboard'`): "Paused:
 * <agent> wants to run <command>", with A to approve and D to deny. The keys
 * act on the newest open gate, and never while focus is in a text field or
 * a dialog, or with a modifier held. Below 640px it stacks: the text on a
 * row of its own, then Approve and Deny side by side (44 px, approvals.css),
 * without the key hints. A lazy chunk: the chat loads it only for
 * a layout that asks.
 */
import { useEffect, useRef, type JSX } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { Pause } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Spinner } from '@/components/ui/spinner'
import { useDecision, type GateProps } from './decision'
import { commandOf, isHighRisk } from './gateText'
import { holdKeys, type GateAct } from './keys'
import './approvals.css'

export default function KeyboardGate(p: GateProps): JSX.Element {
  const [busy, error, act] = useDecision(p)
  const latest = useRef<GateAct>(() => undefined)
  useEffect(() => {
    latest.current = (approved) => {
      if (busy === null) void act(approved)
    }
  })
  useEffect(() => holdKeys(latest), [])
  const command = commandOf(p.args)
  const msgAgent = useAuiState((s) => (s.message.metadata.custom as { agentName?: string }).agentName)
  const who = (p.agent || msgAgent)?.trim() || 'The agent'
  return (
    <div
      role="group"
      aria-label="Approval needed"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-foreground"
      data-approval-gate
      data-approval-keys
      data-risk={p.risk || undefined}
    >
      <Pause className="size-3.5 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 flex-1 basis-[calc(100%-1.75rem)] break-words sm:basis-0" data-gate-text>
        Paused: {who} wants to run{' '}
        {command ? <code className="font-mono text-xs break-all">{command}</code> : (p.label || p.toolName)}
        {p.risk && <span className={isHighRisk(p.risk) ? 'text-destructive' : 'text-muted-foreground'}> · {p.risk} risk</span>}
      </p>
      <div className="flex w-full items-center gap-1.5 sm:w-auto sm:shrink-0" data-gate-actions>
        {/* Keyboard hint: hidden on touch screens, where there is no keyboard to use. */}
        <span className="mr-1 hidden items-center gap-1 text-xs text-muted-foreground sm:[@media(hover:hover)]:inline-flex" aria-hidden>
          <Kbd>A</Kbd> approve <Kbd>D</Kbd> deny
        </span>
        <Button type="button" size="sm" className="flex-1 sm:flex-none" disabled={busy !== null} onClick={() => void act(true)} aria-keyshortcuts="A">
          {busy === 'approve' && <Spinner className="size-3" />}
          Approve
        </Button>
        <Button type="button" size="sm" variant="outline" className="flex-1 sm:flex-none" disabled={busy !== null} onClick={() => void act(false)} aria-keyshortcuts="D">
          {busy === 'deny' && <Spinner className="size-3" />}
          Deny
        </Button>
      </div>
      {error && (
        <p className="w-full text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
