/**
 * The explained approval card (`meta.chat.approvals: 'card'`), in the order
 * of the design (Canvas.dc.html): the tool row (tool, risk, Details), then
 * a shield tile with what the agent wants to do in plain words and why, the
 * exact command as a `$` line, then Approve / Deny with "Why am I asked?"
 * (a disclosure built from the server's description and risk level) and
 * "Paused until you choose". On a phone Deny and Approve split the width as
 * 44 px targets. A lazy chunk: the chat loads it only for a layout that asks.
 */
import { useId, useState, type JSX } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { ChevronRight, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { useDecision, type GateProps } from './decision'
import { commandLabel, commandOf, gateTitle, isHighRisk, isShellCommand, whyAsked } from './gateText'
import './approvals.css'

/** "medium" → "Medium" (only the first letter: "Medium risk", not "Medium Risk"). */
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

export default function ApprovalCard(p: GateProps): JSX.Element {
  const [busy, error, act] = useDecision(p)
  const [why, setWhy] = useState(false)
  const id = useId()
  const msgAgent = useAuiState((s) => (s.message.metadata.custom as { agentName?: string }).agentName)
  const agent = p.agent || msgAgent
  const tool = p.label || p.toolName
  const command = commandOf(p.args)
  const shell = isShellCommand(p.args)
  const high = isHighRisk(p.risk)
  // The tool's description says what it does; the gate's prompt says what is asked. Show both once.
  const lead = p.description && p.description !== p.prompt ? p.description : p.prompt
  const extra = lead === p.prompt ? '' : p.prompt
  return (
    <section
      role="group"
      aria-labelledby={`${id}-h`}
      aria-describedby={`${id}-d`}
      className="flex flex-col gap-2.5 rounded-xl border border-input bg-card p-3.5 text-sm text-foreground"
      data-approval-gate
      data-approval-card
      data-risk={p.risk || undefined}
    >
      {/* The tool row, merged into the card: the tool, its risk, and the arguments disclosure. */}
      {p.expand && (
        <button
          type="button"
          onClick={p.expand.toggle}
          aria-expanded={p.expand.open}
          aria-controls={p.expand.open ? p.expand.panelId : undefined}
          className="-mx-1.5 -mt-1.5 flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          data-approval-tool
        >
          <span className="truncate font-mono text-foreground">{p.toolName}</span>
          {p.risk && (
            <>
              <span aria-hidden>·</span>
              <span className={cn('shrink-0', high && 'text-destructive')}>{sentence(p.risk)} risk</span>
            </>
          )}
          <span className="ml-auto shrink-0">{p.expand.open ? 'Hide details' : 'Details'}</span>
          <ChevronRight className={cn('size-3.5 shrink-0 motion-safe:transition-transform motion-safe:duration-[120ms]', p.expand.open && 'rotate-90')} aria-hidden />
        </button>
      )}
      <div className="flex items-start gap-2.5">
        <span
          className={cn('flex size-[30px] shrink-0 items-center justify-center rounded-lg', high ? 'bg-danger-soft text-destructive' : 'bg-warning-soft text-warning')}
          aria-hidden
        >
          <ShieldAlert className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 id={`${id}-h`} className="text-[15px] font-semibold break-words">{gateTitle(agent, p.toolName, shell)}</h3>
          <p id={`${id}-d`} className="break-words text-muted-foreground">{lead}</p>
        </div>
      </div>
      {/* The exact command (or the argument the gate is about), as a line of shell. */}
      {command && (
        <div className="rounded-lg bg-code px-2.5 py-2 font-mono text-[13.5px] break-all" data-approval-command>
          <span className="sr-only">{commandLabel(p.args)}: </span>
          {shell && <span className="text-tier-3" aria-hidden>$ </span>}
          {command}
        </div>
      )}
      {p.risk && !p.expand && (
        <p className={cn('text-xs text-muted-foreground', high && 'text-destructive')}>{sentence(p.risk)} risk</p>
      )}
      {why && (
        <div id={`${id}-why`} className="space-y-1 rounded-lg bg-muted px-3 py-2" data-why>
          {extra && <p className="break-words">{extra}</p>}
          {whyAsked(p.risk, tool, agent).map((line) => (
            <p key={line} className="break-words text-muted-foreground">{line}</p>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {/* Approve first (the design); on a phone Deny | Approve split the width. */}
        <div className="flex gap-2 max-sm:grid max-sm:w-full max-sm:grid-cols-2">
          <Button type="button" className="max-sm:order-last" disabled={busy !== null} onClick={() => void act(true)}>
            {busy === 'approve' && <Spinner className="size-3.5" />}
            Approve
          </Button>
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void act(false)}>
            {busy === 'deny' && <Spinner className="size-3.5" />}
            Deny
          </Button>
        </div>
        <Button
          type="button"
          variant="link"
          size="sm"
          aria-expanded={why}
          aria-controls={why ? `${id}-why` : undefined}
          onClick={() => setWhy((v) => !v)}
        >
          Why am I asked?
        </Button>
        <span className="ml-auto text-xs text-tier-3 max-sm:hidden">Paused until you choose</span>
      </div>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
