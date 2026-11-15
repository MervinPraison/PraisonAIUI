/**
 * The explained approval card (`meta.chat.approvals: 'card'`): what the agent
 * wants to do in plain words, what it will act on, a "Why am I asked?"
 * disclosure built from the server's description and risk level, then Not now
 * / Approve. A lazy chunk: the chat loads it only for a layout that asks.
 */
import { useId, useState, type JSX } from 'react'
import { useAuiState } from '@assistant-ui/react'
import { ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { useDecision, type GateProps } from './decision'
import { commandLabel, commandOf, gateTitle, isHighRisk, whyAsked } from './gateText'
import './approvals.css'

export default function ApprovalCard(p: GateProps): JSX.Element {
  const [busy, error, act] = useDecision(p)
  const [why, setWhy] = useState(false)
  const id = useId()
  const msgAgent = useAuiState((s) => (s.message.metadata.custom as { agentName?: string }).agentName)
  const agent = p.agent || msgAgent
  const tool = p.label || p.toolName
  const command = commandOf(p.args)
  const high = isHighRisk(p.risk)
  // The tool's description says what it does; the gate's prompt says what is asked. Show both once.
  const lead = p.description && p.description !== p.prompt ? p.description : p.prompt
  const extra = lead === p.prompt ? '' : p.prompt
  return (
    <section
      role="group"
      aria-labelledby={`${id}-h`}
      aria-describedby={`${id}-d`}
      className="flex flex-col gap-3 rounded-xl border border-warning/40 bg-card p-4 text-sm text-foreground"
      data-approval-gate
      data-approval-card
      data-risk={p.risk || undefined}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', high ? 'bg-danger-soft text-destructive' : 'bg-warning-soft text-warning')}
          aria-hidden
        >
          <ShieldAlert className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 id={`${id}-h`} className="text-base font-semibold break-words">{gateTitle(agent, p.toolName)}</h3>
          <p id={`${id}-d`} className="break-words text-muted-foreground">{lead}</p>
        </div>
      </div>
      {(command || p.risk) && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 sm:ml-11">
          {command && (
            <>
              <dt className="text-muted-foreground">{commandLabel(p.args)}</dt>
              <dd className="min-w-0">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs break-all">{command}</code>
              </dd>
            </>
          )}
          {p.risk && (
            <>
              <dt className="text-muted-foreground">Risk</dt>
              <dd className={cn('capitalize', high && 'text-destructive')}>{p.risk}</dd>
            </>
          )}
        </dl>
      )}
      {why && (
        <div id={`${id}-why`} className="space-y-1 rounded-lg bg-muted px-3 py-2 sm:ml-11" data-why>
          {extra && <p className="break-words">{extra}</p>}
          {whyAsked(p.risk, tool, agent).map((line) => (
            <p key={line} className="break-words text-muted-foreground">{line}</p>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 sm:ml-11">
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
        {/* The two decisions stay together (they wrap as a pair on a phone). */}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="outline" size="lg" disabled={busy !== null} onClick={() => void act(false)}>
            {busy === 'deny' && <Spinner className="size-3.5" />}
            Not now
          </Button>
          <Button type="button" size="lg" disabled={busy !== null} onClick={() => void act(true)}>
            {busy === 'approve' && <Spinner className="size-3.5" />}
            Approve
          </Button>
        </div>
      </div>
      {error && (
        <p className="text-xs text-destructive sm:ml-11" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
