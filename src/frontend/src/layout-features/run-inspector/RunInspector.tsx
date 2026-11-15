/**
 * The run inspector (ADR 0003 track K, Command.dc.html "Run inspector"):
 * the open chat's latest run with its status and Stop (⌃C), the pending
 * approval (A / D, "Always allow"), elapsed time, tokens, cost and steps,
 * the Steps timeline (J / K move, ↵ expands) and the files the run's tools
 * touched (F).
 *
 *   variant 'panel'  the desktop side panel
 *   variant 'sheet'  the phone peek above the page: run status and the
 *                    approval row, expanding to the whole inspector
 *
 * Data: the `chat` feed (steps, approval), the `approvals` feed (Always
 * allow), and the run ledger for tokens and cost (./api). Without the chat
 * feed it shows an empty state; without the ledger tokens and cost read "—".
 * A lazy chunk (`lf-run-inspector`): the frame imports it with import().
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type JSX } from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { useLayoutData } from '@/sdk/layouts'
import type { ChatFeed, ChatState } from '@/sdk/layoutTypes'
import { useManifest } from '@/sdk/services'
import { cn } from '@/lib/utils'
import { hasRunLedger, useRunDetail } from './api'
import {
  deriveRun,
  formatCost,
  formatDuration,
  formatTokens,
  statusLabel,
  type InspectorApproval,
  type InspectorFile,
  type InspectorRun,
  type InspectorStep,
} from './steps'

export interface RunInspectorProps {
  variant?: 'panel' | 'sheet'
  /** Panel only: its keys (J K ↵ A D F ⌃C) are live while it is on screen. Default true. */
  keys?: boolean
  /**
   * True for a target the viewer types in, where the panel's keys stay off.
   * The frame passes the kit's (a feature that imported the kit itself would
   * split the kit into one more chunk for every layout).
   */
  isTypingTarget?(target: EventTarget | null): boolean
  className?: string
}

const EMPTY: ChatState = Object.freeze({ sessionId: null, messages: [], isRunning: false })
const noSubscribe = () => () => {}
const empty = () => EMPTY

function useChat(): { feed: ChatFeed | null; state: ChatState } {
  const feed = useLayoutData('chat')
  const read = feed ? feed.get : empty
  const state = useSyncExternalStore(feed ? feed.subscribe : noSubscribe, read, read)
  return { feed, state }
}

/** `now`, ticking every second while `live`. */
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [live])
  return now
}

const TONE: Record<ReturnType<typeof statusLabel>['tone'], string> = {
  warning: 'bg-warning-soft text-warning',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-destructive',
  info: 'bg-info-soft text-info',
  muted: 'bg-muted text-muted-foreground',
}

function StatusPill({ run }: { run: InspectorRun }) {
  const s = statusLabel(run.status)
  return <span className={cn('shrink-0 rounded-xs px-1.5 text-2xs font-medium leading-5', TONE[s.tone])} data-run-status={run.status}>{s.text}</span>
}

const shortId = (id: string | undefined) => (id && id.length > 14 ? id.slice(0, 10) : id)

/*
 * Drawn here rather than imported from lucide-react: the chat route uses
 * those icons too, and an icon both share becomes a chunk of its own,
 * which adds to the chat route's budget.
 */
const glyph = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
const StopGlyph = () => (
  <svg {...glyph} className="size-3.5">
    <rect width="14" height="14" x="5" y="5" rx="2" />
  </svg>
)
const ChevronGlyph = ({ className }: { className?: string }) => (
  <svg {...glyph} className={className}>
    <path d="m18 15-6-6-6 6" />
  </svg>
)
const ShieldGlyph = () => (
  <svg {...glyph} className="size-4 shrink-0 text-warning">
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <path d="M12 8v4" />
    <path d="M12 16h.01" />
  </svg>
)

// ── decisions ────────────────────────────────────────────────────────

function useDecide(chat: ChatFeed | null, approval: InspectorApproval | undefined) {
  const approvals = useLayoutData('approvals')
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [always, setAlways] = useState(false)
  const id = approval?.id
  const [forId, setForId] = useState(id)
  if (forId !== id) {
    setForId(id)
    setBusy(null)
    setError(null)
    setAlways(false)
  }
  const decide = async (approved: boolean) => {
    if (!id || busy) return
    setBusy(approved ? 'approve' : 'deny')
    setError(null)
    try {
      if (approved && always && approvals) await approvals.approve(id, { always: true })
      else if (chat) {
        try {
          await chat.resolveApproval(id, approved)
        } catch (err) {
          // Not in the open chat (another tab's gate): decide it through the approvals feed.
          if (!approvals) throw err
          await (approved ? approvals.approve(id) : approvals.deny(id))
        }
      } else if (approvals) await (approved ? approvals.approve(id) : approvals.deny(id))
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'The decision did not reach the server.')
    } finally {
      setBusy(null)
    }
  }
  return { busy, error, always, setAlways, canAlways: !!approvals, decide }
}

type Decide = ReturnType<typeof useDecide>

function ApprovalBlock({ approval, run, d, touch }: { approval: InspectorApproval; run: InspectorRun; d: Decide; touch: boolean }) {
  const headingId = `aiui-run-approval-${approval.id}`
  return (
    <section
      aria-labelledby={headingId}
      data-run-approval={approval.id}
      className="flex flex-col gap-2.5 rounded-lg border bg-card p-3 [border-color:var(--ui-warning-line)]"
    >
      <div className="flex items-center gap-2">
        <ShieldGlyph />
        <h3 id={headingId} className="m-0 text-sm font-semibold">Approval needed</h3>
        <span className="ml-auto font-mono text-2xs text-tier-3" aria-label={`Waiting ${formatDuration(run.waitingMs, true)}`}>
          waiting {formatDuration(run.waitingMs, true)}
        </span>
      </div>
      <p className="m-0 text-xs text-muted-foreground">{approval.toolName} wants to run</p>
      <pre className="m-0 overflow-x-auto rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-xs whitespace-pre-wrap break-all text-foreground">
        {approval.isCommand && <span className="text-tier-3">$ </span>}
        {approval.call}
      </pre>
      {approval.description && <p className="m-0 text-xs leading-snug text-muted-foreground">{approval.description}</p>}
      {approval.risk && <p className="m-0 text-2xs text-muted-foreground">Risk: {approval.risk}</p>}
      {d.canAlways && (
        <label className={cn('flex items-center gap-2 text-xs text-muted-foreground', touch && 'min-h-11')}>
          <input
            type="checkbox"
            checked={d.always}
            onChange={(e) => d.setAlways(e.target.checked)}
            className="size-4 accent-primary"
          />
          Always allow <span className="font-mono text-2xs">{approval.toolName}</span> here
        </label>
      )}
      <div className="flex gap-2">
        <Button
          className={cn('flex-1', touch && 'h-11')}
          disabled={d.busy !== null}
          aria-keyshortcuts="A"
          onClick={() => void d.decide(true)}
          data-run-approve
        >
          Approve {!touch && <Kbd className="border-primary-foreground/30 bg-primary-foreground/15 text-primary-foreground">A</Kbd>}
        </Button>
        <Button
          variant="outline"
          className={cn('flex-1', touch && 'h-11')}
          disabled={d.busy !== null}
          aria-keyshortcuts="D"
          onClick={() => void d.decide(false)}
          data-run-deny
        >
          Deny {!touch && <Kbd>D</Kbd>}
        </Button>
      </div>
      {d.error && <p role="alert" className="m-0 text-2xs text-destructive">{d.error}</p>}
    </section>
  )
}

// ── metrics, steps, files ────────────────────────────────────────────

function Metrics({ run, tokens, tokensSub, cost, model }: { run: InspectorRun; tokens: string; tokensSub: string; cost: string; model: string }) {
  const waiting = run.steps.filter((s) => s.state === 'waiting').length
  const items = [
    { label: 'Elapsed', value: formatDuration(run.elapsedMs), sub: run.approval ? `+${formatDuration(run.waitingMs, true)} waiting` : run.endedAt ? 'finished' : 'live' },
    { label: 'Tokens', value: tokens, sub: tokensSub },
    { label: 'Cost', value: cost, sub: model },
    { label: 'Steps', value: `${run.doneSteps}/${run.steps.length}`, sub: waiting ? `${waiting} waiting` : '' },
  ]
  return (
    <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border @[19rem]:grid-cols-4" data-run-metrics>
      {items.map((m) => (
        <div key={m.label} className="min-w-0 bg-card px-2.5 py-2">
          <dt className="text-2xs text-tier-3">{m.label}</dt>
          <dd className="m-0 mt-0.5 truncate font-mono text-sm font-medium tabular-nums">{m.value}</dd>
          <dd className="m-0 truncate font-mono text-[11px] text-tier-3">{m.sub || ' '}</dd>
        </div>
      ))}
    </dl>
  )
}

const DOT: Record<InspectorStep['state'], string> = {
  waiting: 'bg-warning',
  done: 'bg-success',
  running: 'bg-info',
  error: 'bg-destructive',
}

function StepRow({ step, expanded, onToggle }: { step: InspectorStep; expanded: boolean; onToggle(): void }) {
  const waiting = step.state === 'waiting'
  const bodyId = `aiui-run-step-${step.id}`
  return (
    <li>
      <button
        type="button"
        aria-expanded={step.body ? expanded : undefined}
        aria-controls={step.body ? bodyId : undefined}
        onClick={onToggle}
        data-run-step={step.n}
        data-state={step.state}
        className={cn(
          'grid w-full grid-cols-[1.375rem_minmax(0,1fr)_auto] items-start gap-x-2 rounded-md border px-2 py-1.5 text-left outline-none',
          'hover:bg-card focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring',
          waiting ? 'bg-card [border-color:var(--ui-warning-line)]' : 'border-transparent',
        )}
      >
        <span className="font-mono text-[11px] leading-[1.125rem] text-tier-3">{step.n}</span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-2xs leading-[1.125rem] text-tier-3">
            <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', step.kind === 'reasoning' && step.state === 'done' ? 'bg-tier-3' : DOT[step.state])} />
            {step.kindLabel}
          </span>
          <span className="truncate font-mono text-xs text-foreground">{step.title}</span>
          {step.detail && <span className="truncate font-mono text-[11px] text-tier-3">{step.detail}</span>}
          <span aria-hidden className="relative mt-1 block h-1 rounded-full bg-muted">
            <span
              className={cn('absolute inset-y-0 rounded-full', waiting ? 'bg-warning' : 'bg-primary/40')}
              style={{ left: `${step.x}%`, width: `${step.w}%` }}
            />
          </span>
        </span>
        <span className={cn('font-mono text-2xs leading-[1.125rem] tabular-nums', waiting ? 'text-warning' : 'text-muted-foreground')}>
          {formatDuration(step.durationMs, waiting)}
        </span>
      </button>
      {step.body && expanded && (
        <pre id={bodyId} className="m-0 mt-1 ml-7 max-h-48 overflow-auto rounded-md bg-muted px-2.5 py-2 font-mono text-[11px] whitespace-pre-wrap break-words text-muted-foreground">
          {step.body}
        </pre>
      )}
    </li>
  )
}

function filesSummary(files: readonly InspectorFile[]): string {
  const written = files.filter((f) => f.state === 'written').length
  const pending = files.filter((f) => f.state === 'if approved').length
  const read = files.filter((f) => f.state === 'read').length
  return [`${written} written`, pending ? `${pending} if approved` : '', read ? `${read} read` : ''].filter(Boolean).join(' · ')
}

const SectionTitle = ({ id, children, aside }: { id: string; children: string; aside?: string }) => (
  <div className="flex items-center gap-2 px-0.5 pb-1">
    <h3 id={id} className="m-0 text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">{children}</h3>
    {aside && <span className="ml-auto font-mono text-[11px] text-tier-3">{aside}</span>}
  </div>
)

// ── the inspector ────────────────────────────────────────────────────

/** Fields and editors, when the frame passes no check of its own. */
const FIELDS = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'
const inField = (t: EventTarget | null) => !!(t as Element | null)?.closest?.(FIELDS)

/** Keys that belong to something else: typing, a dialog or menu, a modifier. */
function foreignKey(e: KeyboardEvent, typing: (t: EventTarget | null) => boolean): boolean {
  if (e.defaultPrevented || e.isComposing || e.metaKey || e.altKey) return true
  if (typing(e.target)) return true
  const t = e.target as Element | null
  return !!t?.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')
}

export default function RunInspector({ variant = 'panel', keys = true, isTypingTarget = inField, className }: RunInspectorProps): JSX.Element | null {
  const { feed: chat, state } = useChat()
  const seen = useRef(new Map<string, number>()).current
  const [live, setLive] = useState(false)
  const now = useNow(live)
  const run = useMemo(() => deriveRun(state.messages, now, seen), [state.messages, now, seen])
  const isLive = !!run && (run.status === 'running' || run.status === 'waiting')
  useEffect(() => setLive(isLive), [isLive])

  const manifest = useManifest()
  const detail = useRunDetail(run?.runId, hasRunLedger(manifest), `${run?.status}:${run?.steps.length}`)
  const d = useDecide(chat, run?.approval)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [open, setOpen] = useState(false)
  const stepsRef = useRef<HTMLOListElement>(null)
  const filesRef = useRef<HTMLUListElement>(null)
  const sheet = variant === 'sheet'
  const latest = useRef({ run, d, chat })
  useEffect(() => {
    latest.current = { run, d, chat }
  })

  // J / K / F / A / D / ⌃C (panel only; Enter is the focused step button's own).
  useEffect(() => {
    if (sheet || !keys) return
    const onKey = (e: KeyboardEvent) => {
      const { run: r, d: dd, chat: c } = latest.current
      const key = e.key.toLowerCase()
      if (key === 'c' && e.ctrlKey && !e.metaKey && !e.shiftKey) {
        // ⌃C stops the run, unless there is text to copy.
        const sel = typeof window.getSelection === 'function' ? window.getSelection()?.toString() : ''
        const field = e.target as HTMLInputElement | null
        const fieldSel = field && typeof field.selectionStart === 'number' && field.selectionStart !== field.selectionEnd
        if (!r || (r.status !== 'running' && r.status !== 'waiting') || sel || fieldSel || !c) return
        e.preventDefault()
        void c.cancel()
        return
      }
      if (e.ctrlKey || e.shiftKey || foreignKey(e, isTypingTarget)) return
      if (key === 'j' || key === 'k') {
        const rows = [...(stepsRef.current?.querySelectorAll<HTMLButtonElement>('[data-run-step]') ?? [])]
        if (!rows.length) return
        e.preventDefault()
        const at = rows.indexOf(document.activeElement as HTMLButtonElement)
        const next = at < 0 ? (key === 'j' ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + (key === 'j' ? 1 : -1)))
        rows[next].focus()
      } else if (key === 'f' && filesRef.current) {
        e.preventDefault()
        filesRef.current.focus()
      } else if ((key === 'a' || key === 'd') && r?.approval && !dd.busy) {
        e.preventDefault()
        void dd.decide(key === 'a')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet, keys, isTypingTarget])

  const tokens = formatTokens(detail?.tokens) ?? '—'
  const tokensSub = detail?.tokensIn !== undefined && detail.tokensOut !== undefined ? `${formatTokens(detail.tokensIn)} in · ${formatTokens(detail.tokensOut)} out` : ''
  const cost = formatCost(detail?.cost) ?? '—'
  const model = detail?.model ?? (detail?.approximate ? 'approximate' : '')
  const stop = run && isLive && chat ? () => void chat.cancel() : null

  const body = run ? (
    <div className="@container flex flex-col gap-4">
      {run.approval && !sheet && <ApprovalBlock approval={run.approval} run={run} d={d} touch={false} />}
      <Metrics run={run} tokens={tokens} tokensSub={tokensSub} cost={cost} model={model} />
      <section aria-labelledby="aiui-run-steps-h" className="flex flex-col gap-1">
        <SectionTitle id="aiui-run-steps-h" aside={`0s ─ ${formatDuration(run.elapsedMs)}`}>Steps</SectionTitle>
        {run.steps.length === 0 ? (
          <p className="m-0 px-0.5 text-xs text-muted-foreground">No steps yet.</p>
        ) : (
          <ol ref={stepsRef} className="m-0 flex list-none flex-col gap-0.5 p-0">
            {run.steps.map((s) => (
              <StepRow
                key={s.id}
                step={s}
                expanded={expanded.has(s.id)}
                onToggle={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev)
                    if (!next.delete(s.id)) next.add(s.id)
                    return next
                  })
                }
              />
            ))}
          </ol>
        )}
      </section>
      <section aria-labelledby="aiui-run-files-h" className="flex flex-col gap-1">
        <SectionTitle id="aiui-run-files-h" aside={run.files.length ? filesSummary(run.files) : undefined}>Files touched</SectionTitle>
        {run.files.length === 0 ? (
          <p className="m-0 px-0.5 text-xs text-muted-foreground">No files touched.</p>
        ) : (
          <ul
            ref={filesRef}
            tabIndex={-1}
            aria-labelledby="aiui-run-files-h"
            className="m-0 flex list-none flex-col overflow-hidden rounded-md border border-border bg-card p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-run-files
          >
            {run.files.map((f, i) => (
              <li key={f.path} className={cn('flex items-center gap-2 px-2.5 py-1.5', i > 0 && 'border-t border-border')}>
                <FileText aria-hidden className="size-3.5 shrink-0 text-tier-3" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f.path}>{f.path}</span>
                <span className={cn('shrink-0 text-2xs', f.state === 'if approved' ? 'text-warning' : f.state === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>
                  {f.state}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  ) : null

  if (sheet) {
    if (!run) return null
    return (
      <section
        aria-label="Run inspector"
        data-run-inspector="sheet"
        className={cn('flex shrink-0 flex-col gap-1.5 rounded-t-2xl border-t border-input bg-sidebar px-3 pt-1.5 pb-2.5 shadow-lg', className)}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? 'Collapse run panel' : 'Expand run panel'}
          onClick={() => setOpen((o) => !o)}
          className="flex min-h-11 w-full flex-col items-stretch gap-1 rounded-md px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden className="h-1 w-9 self-center rounded-full bg-input" />
          <span className="flex items-center gap-2">
            <span className="text-base font-semibold">Run</span>
            <StatusPill run={run} />
            <span className="ml-auto font-mono text-2xs text-muted-foreground">
              {run.doneSteps}/{run.steps.length}{cost !== '—' ? ` · ${cost}` : ''}
            </span>
            <ChevronGlyph className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
          </span>
        </button>
        {run.approval && (
          <div className="flex items-center gap-2 rounded-lg border bg-card p-2 [border-color:var(--ui-warning-line)]" data-run-approval={run.approval.id}>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-2xs text-tier-3">{run.approval.toolName} wants to run</span>
              <span className="truncate font-mono text-sm">
                {run.approval.isCommand && <span className="text-tier-3">$ </span>}
                {run.approval.call}
              </span>
            </div>
            <Button variant="outline" className="h-11 px-3.5 text-base" disabled={d.busy !== null} onClick={() => void d.decide(false)} data-run-deny>
              Deny
            </Button>
            <Button className="h-11 px-4 text-base" disabled={d.busy !== null} onClick={() => void d.decide(true)} data-run-approve>
              Approve
            </Button>
          </div>
        )}
        {d.error && <p role="alert" className="m-0 text-2xs text-destructive">{d.error}</p>}
        {open && <div className="max-h-[55vh] overflow-y-auto pt-1">{body}</div>}
      </section>
    )
  }

  return (
    <aside aria-label="Run inspector" data-run-inspector="panel" className={cn('flex min-h-0 min-w-0 flex-col bg-sidebar', className)}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border pr-2.5 pl-4">
        <h2 className="m-0 text-sm font-semibold">Run</h2>
        {run?.runId && <span className="min-w-0 truncate font-mono text-2xs text-tier-3">{shortId(run.runId)}</span>}
        {run && <StatusPill run={run} />}
        {stop && (
          <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" aria-keyshortcuts="Control+C" onClick={stop} data-run-stop>
            <StopGlyph />
            Stop <Kbd>⌃C</Kbd>
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
        {!chat ? (
          <p className="m-0 text-sm text-muted-foreground">Run details appear here when chat is on.</p>
        ) : !run ? (
          <div className="flex flex-col gap-1 text-sm text-muted-foreground" data-run-empty>
            <p className="m-0 font-medium text-foreground">No run yet</p>
            <p className="m-0">Ask something: its steps, tokens and cost show here.</p>
          </div>
        ) : (
          body
        )}
      </div>
      <div className="hidden shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border px-4 py-2 text-2xs text-tier-3 [@media(hover:hover)]:flex" aria-hidden>
        <span className="flex items-center gap-1"><Kbd>J</Kbd><Kbd>K</Kbd> step</span>
        <span className="flex items-center gap-1"><Kbd>↵</Kbd> expand</span>
        <span className="flex items-center gap-1"><Kbd>A</Kbd> approve</span>
        <span className="flex items-center gap-1"><Kbd>D</Kbd> deny</span>
        <span className="flex items-center gap-1"><Kbd>F</Kbd> files</span>
      </div>
    </aside>
  )
}
