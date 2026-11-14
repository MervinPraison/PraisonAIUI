/**
 * chat-engine/Thread.tsx — the chat thread, built from assistant-ui primitives
 * in the AI Elements idiom and styled with shell tokens only.
 *
 * - User messages: a subtle filled bubble on the right. Assistant messages:
 *   full width, no bubble.
 * - Tool calls: compact collapsible rows (icon, name, status pill, duration)
 *   that expand to arguments/result; an approval gate is an inline card.
 * - Reasoning: a collapsible "Thought for Ns" row.
 * - Markdown is the WP1 `<Markdown variant="chat">` contract; it is mounted
 *   only for non-empty text, so the renderer chunk is not fetched before the
 *   first text arrives.
 * - Element, ask and A2UI parts are lazy chunks.
 */
import { createContext, lazy, memo, useContext, useMemo, useState, type ComponentType, type FC, type MouseEvent, type ReactElement } from 'react'
import {
  ActionBarPrimitive,
  AttachmentPrimitive,
  AuiIf,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  useAuiState,
  useMessagePartText,
  type DataMessagePartProps,
  type ReasoningMessagePartProps,
  type ToolCallMessagePartProps,
} from '@assistant-ui/react'
import {
  ArrowDown, ArrowUp, Brain, Check, ChevronRight, Code, Copy, FileText, Globe, Paperclip, RefreshCw, Search,
  ShieldAlert, Square, Terminal, ThumbsDown, ThumbsUp, Wrench, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Markdown } from '@/markdown/LazyMarkdown'
import { getToolRenderers, useRegistryVersion, type AnyComponent } from '@/sdk/registry'
import { cn } from '@/lib/utils'
import { LazyBoundary } from './parts/LazyBoundary'
import { APPROVAL_ERROR, APPROVAL_PENDING, PENDING_APPROVAL } from './protocol'
import { formatDuration, safeUrl } from './util'

const AskToolLazy = lazy(() => import('./parts/AskTool'))
const ElementPartLazy = lazy(() => import('./parts/ElementPart'))
const A2uiPartLazy = lazy(() => import('./parts/A2uiPart'))

/** The thread's session id, for parts that post back to the server (A2UI surface actions). */
const SessionIdContext = createContext<string | undefined>(undefined)

/** Reading column: prose width for chat (DESIGN.md: 760px). */
const COLUMN = 'mx-auto w-full max-w-[760px]'

// ── message parts ───────────────────────────────────────────────────────

const TextPart: FC = () => {
  const { text, status } = useMessagePartText()
  if (!text.trim()) return null
  return (
    <Markdown variant="chat" streaming={status.type === 'running'} className="min-w-0 max-w-full">
      {text}
    </Markdown>
  )
}

const Reasoning: FC<ReasoningMessagePartProps> = ({ text, status, timing }) => {
  const [open, setOpen] = useState(false)
  const done = Boolean(timing?.completedAt) || status.type !== 'running'
  const body = text.replace(/\u200b/g, '').trim()
  const took = timing?.completedAt && timing.startedAt ? formatDuration(timing.completedAt - timing.startedAt) : ''
  const label = done ? (took ? `Thought for ${took}` : 'Thought process') : 'Thinking…'
  return (
    <div className="my-1.5" data-part="reasoning">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!body}
        aria-expanded={open}
        className="-mx-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:hover:text-muted-foreground"
      >
        {done ? <Brain className="size-4" aria-hidden /> : <Spinner className="size-3.5" />}
        <span>{label}</span>
        {body && (
          <ChevronRight className={cn('size-3.5 motion-safe:transition-transform motion-safe:duration-[120ms]', open && 'rotate-90')} aria-hidden />
        )}
      </button>
      {open && body && (
        <div className="mt-1 ml-2 min-w-0 border-l border-border pl-4 text-sm leading-relaxed break-words text-muted-foreground" data-reasoning-body>
          <Markdown variant="chat" streaming={!done} className="min-w-0 max-w-full text-sm text-muted-foreground">
            {body}
          </Markdown>
        </div>
      )}
    </div>
  )
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

type ToolState = 'running' | 'done' | 'error' | 'approval' | 'approved' | 'denied' | 'stopped'

/**
 * Line icons for well-known tools (the server's emoji would clash with the
 * lucide set). Static elements: rendering one never creates a component.
 */
const TOOL_ICON_CLASS = 'size-3.5'
const TOOL_ICON_RULES: [RegExp, ReactElement][] = [
  [/search|lookup|query|find|grep/i, <Search className={TOOL_ICON_CLASS} />],
  [/shell|bash|command|exec|terminal|run_?cmd/i, <Terminal className={TOOL_ICON_CLASS} />],
  [/web|url|fetch|http|browse|crawl|scrape/i, <Globe className={TOOL_ICON_CLASS} />],
  [/file|read|write|edit|document|pdf/i, <FileText className={TOOL_ICON_CLASS} />],
  [/code|python|javascript|eval|interpreter/i, <Code className={TOOL_ICON_CLASS} />],
]
const DEFAULT_TOOL_ICON = <Wrench className={TOOL_ICON_CLASS} />

function toolIcon(name: string): ReactElement {
  for (const [re, icon] of TOOL_ICON_RULES) if (re.test(name)) return icon
  return DEFAULT_TOOL_ICON
}

const PILL: Record<ToolState, { label: string; className: string }> = {
  running: { label: 'Running', className: 'bg-muted text-muted-foreground' },
  done: { label: 'Done', className: 'bg-muted text-muted-foreground' },
  error: { label: 'Failed', className: 'bg-destructive/10 text-destructive' },
  approval: { label: 'Needs approval', className: 'bg-primary/10 text-foreground' },
  approved: { label: 'Approved', className: 'bg-muted text-muted-foreground' },
  denied: { label: 'Denied', className: 'bg-muted text-muted-foreground' },
  stopped: { label: 'Stopped', className: 'bg-muted text-muted-foreground' },
}

function toolState(p: ToolCallMessagePartProps): ToolState {
  if (p.isError) return 'error'
  if (p.approval && p.approval.approved === undefined) return 'approval'
  if (p.approval?.approved === false) return 'denied'
  if (p.result !== undefined) return 'done'
  if (p.approval?.approved === true) return 'approved'
  if (p.status.type === 'incomplete') return 'stopped'
  // No result frame but the run finished (hook-only tools, or a result the server never sent).
  if (p.status.type === 'complete') return 'done'
  return 'running'
}

/**
 * Approve/Deny. The decision in flight (`pending`) and a rejected one (`error`)
 * come from the tool part, so they survive the gate remounting; the local
 * state only covers the moment between the click and the store update.
 */
function ApprovalGate({ prompt, risk, pending, error: partError, respond }: {
  prompt: string
  risk?: string
  pending?: string
  error?: string
  respond: (approved: boolean) => Promise<void>
}) {
  const [clicked, setClicked] = useState<null | 'approve' | 'deny'>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const busy = pending === 'approve' || pending === 'deny' ? pending : clicked
  const error = partError ?? localError
  const act = async (approved: boolean) => {
    setClicked(approved ? 'approve' : 'deny')
    setLocalError(null)
    try {
      await respond(approved)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'The decision could not be sent')
    } finally {
      setClicked(null)
    }
  }
  const high = risk === 'high' || risk === 'critical'
  return (
    <div className="border-t border-border px-3 py-2.5" data-approval-gate>
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <ShieldAlert className={cn('mt-0.5 size-4 shrink-0', high ? 'text-destructive' : 'text-muted-foreground')} aria-hidden />
          <p className="min-w-0 text-sm break-words text-foreground">
            {prompt}
            {risk && (
              <span className={cn('ml-2 inline-block rounded px-1.5 text-xs', high ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground')}>
                {risk} risk
              </span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2 pl-6 sm:pl-0">
          <Button type="button" size="sm" disabled={busy !== null} onClick={() => void act(true)}>
            {busy === 'approve' && <Spinner className="size-3.5" />}
            Approve
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void act(false)}>
            {busy === 'deny' && <Spinner className="size-3.5" />}
            Deny
          </Button>
        </div>
      </div>
      {error && (
        <p className="mt-2 pl-6 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/** Arguments/result: flat, marked by a left rule (no box inside the row). */
const TOOL_PRE =
  'max-h-72 overflow-auto border-l-2 border-border pl-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground'

/** Default tool UI: a compact collapsible row; an open approval gate renders inline. */
const ToolCard: FC<ToolCallMessagePartProps> = (props) => {
  const { toolName, args, result, artifact, approval, respondToApproval, timing } = props
  const [open, setOpen] = useState(false)
  const sessionId = useContext(SessionIdContext)
  const a = (artifact ?? {}) as Record<string, unknown>
  const state = toolState(props)
  const pill = PILL[state]
  // The server's emoji icon is not shown (one line-icon set); it is only
  // stripped from the description it may prefix.
  const emoji = typeof a.icon === 'string' && a.icon ? a.icon : null
  const description = typeof a.description === 'string' ? a.description.replace(emoji ?? '\u0000', '').trim() : ''
  const took = timing?.completedAt ? formatDuration(timing.completedAt - timing.startedAt) : ''
  const hasArgs = args && Object.keys(args).length > 0
  const a2ui = Array.isArray(a.a2ui) && a.a2ui.length ? (a.a2ui as Record<string, unknown>[]) : null
  // Flat row; a hairline only once it holds something (expanded, a gate, a surface).
  const framed = open || state === 'approval' || a2ui !== null
  return (
    <div
      className={cn('my-1.5 min-w-0 rounded-md', framed && 'border border-border', state === 'approval' && 'shadow-sm')}
      data-tool={toolName}
      data-state={state}
      data-open={open || undefined}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
          {toolIcon(toolName)}
        </span>
        <span className="shrink-0 font-medium text-foreground">{toolName}</span>
        {description && <span className="min-w-0 truncate text-muted-foreground">{description}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs', pill.className)}>
            {state === 'running' && <Spinner className="size-3" />}
            {pill.label}
          </span>
          {took && <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">{took}</span>}
          <ChevronRight className={cn('size-3.5 text-muted-foreground motion-safe:transition-transform motion-safe:duration-[120ms]', open && 'rotate-90')} aria-hidden />
        </span>
      </button>
      {approval && approval.approved === undefined && (
        <ApprovalGate
          prompt={approval.prompt ?? `Allow ${toolName}?`}
          risk={typeof a.risk_level === 'string' ? a.risk_level : undefined}
          pending={typeof a[APPROVAL_PENDING] === 'string' ? a[APPROVAL_PENDING] : undefined}
          error={typeof a[APPROVAL_ERROR] === 'string' ? a[APPROVAL_ERROR] : undefined}
          respond={(approved) => respondToApproval({ approved })}
        />
      )}
      {open && (
        <div className="space-y-3 px-3 pt-1 pb-3">
          {description && <p className="text-xs break-words text-muted-foreground sm:hidden">{description}</p>}
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">Arguments</div>
            <pre className={TOOL_PRE}>{hasArgs ? stringify(args) : '{}'}</pre>
          </div>
          {result !== undefined && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Result</div>
              <pre className={TOOL_PRE}>{stringify(result)}</pre>
            </div>
          )}
        </div>
      )}
      {a2ui && (
        <div className="border-t border-border px-3 py-2">
          <LazyBoundary fallback={<Skeleton className="h-16 w-full" />}>
            <A2uiPartLazy sessionId={sessionId} data={{ messages: a2ui, surface_id: typeof a.surface_id === 'string' ? a.surface_id : undefined }} />
          </LazyBoundary>
        </div>
      )}
    </div>
  )
}

const AskTool: FC<ToolCallMessagePartProps> = (props) => (
  <LazyBoundary fallback={<Skeleton className="my-3 h-20 w-full rounded-xl" />}>
    <AskToolLazy {...props} />
  </LazyBoundary>
)

const ElementPart: FC<DataMessagePartProps<Record<string, unknown>>> = ({ data }) => (
  <LazyBoundary fallback={<Skeleton className="my-2 h-24 w-48 rounded-lg" />}>
    <ElementPartLazy data={data} />
  </LazyBoundary>
)

const A2uiPart: FC<DataMessagePartProps<{ surface_id?: string; messages?: Record<string, unknown>[] }>> = ({ data }) => {
  const sessionId = useContext(SessionIdContext)
  return (
    <LazyBoundary fallback={<Skeleton className="my-2 h-24 w-full rounded-lg" />}>
      <A2uiPartLazy data={data} sessionId={sessionId} />
    </LazyBoundary>
  )
}

type Ref = { name?: string; title?: string; source?: string; content?: string; url?: string }

const ReferencesPart: FC<DataMessagePartProps<{ query?: string; references: Ref[] }>> = ({ data }) => (
  <div className="my-2 flex min-w-0 flex-wrap items-center gap-1.5" data-part="references">
    <span className="mr-0.5 text-xs text-muted-foreground">Sources</span>
    {(data.references ?? []).map((r: Ref, i: number) => {
      const name = r.title ?? r.name ?? r.source ?? r.url ?? `Source ${i + 1}`
      const chip = (
        <>
          <span className="tabular-nums text-muted-foreground">[{i + 1}]</span>
          <span className="truncate">{name}</span>
        </>
      )
      const cls = 'inline-flex max-w-full min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-foreground'
      const href = safeUrl(r.url)
      return href ? (
        <a key={i} href={href} title={r.content} target="_blank" rel="noopener noreferrer nofollow" className={cn(cls, 'hover:underline')}>
          {chip}
        </a>
      ) : (
        <span key={i} title={r.content} className={cls}>
          {chip}
        </span>
      )
    })}
  </div>
)

const MemoryPart: FC<DataMessagePartProps<{ status: string }>> = ({ data }) => (
  <div className="my-1 flex items-center gap-1.5 text-xs text-muted-foreground" data-part="memory">
    {data.status === 'running' ? <Spinner className="size-3" /> : <Check className="size-3" aria-hidden />}
    {data.status === 'running' ? 'Updating memory' : 'Memory updated'}
  </div>
)

/** Opens the approvals page in the shell (its router follows history changes), else as a plain link. */
function openApprovals(e: MouseEvent<HTMLAnchorElement>) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  if (document.documentElement.dataset.aiuiShell !== 'react') return
  e.preventDefault()
  window.history.pushState(window.history.state, '', '/approvals')
}

/**
 * An approval the stream could not describe (older WS servers drop the gate's
 * details). The chat page swaps it for a real gate when the approval record
 * arrives as an `aiui:approval-required` event; until then it points to the
 * approvals page, where the request can be decided.
 */
const PendingApprovalPart: FC<DataMessagePartProps<{ tool_name?: string }>> = ({ data }) => (
  <div className="my-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border px-3 py-2 text-sm" data-part="approval-pending" role="status">
    <ShieldAlert className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    <span className="min-w-0 flex-1 text-foreground">
      {data.tool_name ? `Waiting for approval to run ${data.tool_name}` : 'Waiting for an approval'}
    </span>
    <a href="/approvals" onClick={openApprovals} className="shrink-0 rounded-sm text-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
      Review in Approvals
    </a>
  </div>
)

/** Plugin tool renderers run inside a boundary so one broken plugin cannot take the thread down. */
const guarded = new WeakMap<AnyComponent, AnyComponent>()
function guard(C: AnyComponent): AnyComponent {
  let g = guarded.get(C)
  if (!g) {
    const Guarded: FC<ToolCallMessagePartProps> = (p) => (
      <LazyBoundary>
        <C {...p} />
      </LazyBoundary>
    )
    g = Guarded
    guarded.set(C, g)
  }
  return g
}

// ── messages ────────────────────────────────────────────────────────────

const iconButton = 'text-muted-foreground hover:text-foreground'

const MessageStatusNotes: FC = () => {
  const s = useAuiState((st) => {
    const status = st.message.status
    const custom = st.message.metadata.custom as { reconnecting?: boolean; remote?: boolean }
    if (custom.reconnecting) return 'reconnecting'
    if (custom.remote && status?.type === 'running') return 'remote'
    if (status?.type === 'running' && st.message.content.length === 0) return 'pending'
    if (status?.type === 'incomplete' && status.reason === 'cancelled') return 'stopped'
    return null
  })
  if (s === 'pending') {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground" role="status" aria-live="polite">
        <Spinner className="size-3.5" /> Thinking…
      </div>
    )
  }
  if (s === 'reconnecting') {
    return (
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground" role="status" aria-live="polite">
        <Spinner className="size-3" /> Connection lost. Reconnecting…
      </div>
    )
  }
  if (s === 'stopped') return <div className="mt-1 text-xs text-muted-foreground">Stopped</div>
  if (s === 'remote') {
    return (
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground" role="status" data-remote-turn>
        <Spinner className="size-3" /> Replying in another tab or window
      </div>
    )
  }
  return null
}

type PartComponents = Parameters<typeof MessagePrimitive.Parts>[0]['components']
const PartsContext = createContext<PartComponents>(undefined)

/**
 * Earlier answers keep their actions in the DOM (autohide="never") and reveal
 * them on hover, on keyboard focus inside the message, and always on touch
 * screens. The library's autohide reacts to mouseenter only and unmounts the
 * hidden bar, so Tab could never reach Copy or feedback on an earlier answer.
 */
const REVEAL_ON_HOVER =
  'opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 [@media(hover:none)]:opacity-100 motion-safe:transition-opacity motion-safe:duration-[120ms]'

const AssistantMessage: FC = () => {
  const components = useContext(PartsContext)
  const agent = useAuiState((s) => (s.message.metadata.custom as { agentName?: string }).agentName)
  const isLast = useAuiState((s) => s.message.isLast)
  return (
    <MessagePrimitive.Root className={cn(COLUMN, 'group/msg min-w-0 py-3')} data-role="assistant">
      {agent && <div className="mb-1 text-xs font-medium text-muted-foreground">{agent}</div>}
      <div className="min-w-0 text-base leading-[1.55] break-words text-foreground">
        <MessagePrimitive.Parts components={components} />
      </div>
      <MessageStatusNotes />
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
      <ActionBarPrimitive.Root hideWhenRunning autohide="never" className={cn('mt-1 -ml-1.5 flex gap-0.5', !isLast && REVEAL_ON_HOVER)}>
        <ActionBarPrimitive.Copy asChild>
          <Button variant="ghost" size="icon-xs" className={cn(iconButton, 'group/copy')} aria-label="Copy">
            <Copy className="group-data-[copied]/copy:hidden" />
            <Check className="hidden group-data-[copied]/copy:block" />
          </Button>
        </ActionBarPrimitive.Copy>
        {/* Only the last answer can be regenerated (the server answers its last question again). */}
        <AuiIf condition={(st) => st.message.isLast && st.thread.capabilities.reload}>
          <ActionBarPrimitive.Reload asChild>
            <Button variant="ghost" size="icon-xs" className={iconButton} aria-label="Regenerate">
              <RefreshCw />
            </Button>
          </ActionBarPrimitive.Reload>
        </AuiIf>
        <ActionBarPrimitive.FeedbackPositive asChild>
          <Button variant="ghost" size="icon-xs" className={cn(iconButton, 'data-[submitted]:text-foreground')} aria-label="Good response">
            <ThumbsUp />
          </Button>
        </ActionBarPrimitive.FeedbackPositive>
        <ActionBarPrimitive.FeedbackNegative asChild>
          <Button variant="ghost" size="icon-xs" className={cn(iconButton, 'data-[submitted]:text-foreground')} aria-label="Bad response">
            <ThumbsDown />
          </Button>
        </ActionBarPrimitive.FeedbackNegative>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  )
}

const MessageAttachment: FC = () => (
  <AttachmentPrimitive.Root className="inline-flex max-w-56 min-w-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
    <Paperclip className="size-3 shrink-0" aria-hidden />
    <span className="truncate">
      <AttachmentPrimitive.Name />
    </span>
  </AttachmentPrimitive.Root>
)

const UserMessage: FC = () => (
  <MessagePrimitive.Root className={cn(COLUMN, 'flex min-w-0 flex-col items-end gap-1.5 py-2')} data-role="user">
    <div className="flex max-w-full flex-wrap justify-end gap-1.5 empty:hidden">
      <MessagePrimitive.Attachments>{() => <MessageAttachment />}</MessagePrimitive.Attachments>
    </div>
    <div className="max-w-[85%] min-w-0 rounded-2xl bg-muted px-4 py-2.5 text-base leading-[1.55] whitespace-pre-wrap break-words text-foreground">
      <MessagePrimitive.Parts />
    </div>
  </MessagePrimitive.Root>
)

const SystemMessage: FC = () => (
  <MessagePrimitive.Root className={cn(COLUMN, 'py-2 text-center text-xs text-muted-foreground')} data-role="system">
    <MessagePrimitive.Parts />
  </MessagePrimitive.Root>
)

// ── composer ────────────────────────────────────────────────────────────

const ComposerAttachment: FC = () => (
  <AttachmentPrimitive.Root className="inline-flex max-w-56 min-w-0 items-center gap-1.5 rounded-lg border border-border bg-muted/50 py-1 pr-1 pl-2 text-xs">
    <Paperclip className="size-3 shrink-0 text-muted-foreground" aria-hidden />
    <span className="truncate">
      <AttachmentPrimitive.Name />
    </span>
    <AttachmentPrimitive.Remove asChild>
      <Button variant="ghost" size="icon-xs" className="size-5 text-muted-foreground hover:text-foreground" aria-label="Remove attachment">
        <X />
      </Button>
    </AttachmentPrimitive.Remove>
  </AttachmentPrimitive.Root>
)

/** Focus the composer on load only with a mouse/trackpad: on a phone it would open the keyboard over the thread. */
function finePointer(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches
  } catch {
    return false
  }
}

export interface ComposerNotice {
  text: string
  onDismiss?: () => void
}

const Composer: FC<{ placeholder?: string; notice?: ComposerNotice | null }> = ({ placeholder, notice }) => (
  <>
    {notice && (
      <div className="mb-2 flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-foreground" role="alert">
        <span className="min-w-0 flex-1 break-words">{notice.text}</span>
        {notice.onDismiss && (
          <Button variant="ghost" size="icon-xs" className="text-muted-foreground" onClick={notice.onDismiss} aria-label="Dismiss">
            <X />
          </Button>
        )}
      </div>
    )}
    <ComposerPrimitive.Root className="flex w-full min-w-0 flex-col rounded-xl border border-border bg-background shadow-sm motion-safe:transition-shadow motion-safe:duration-[120ms] focus-within:border-ring/30 focus-within:shadow-md has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/30">
      <div className="flex flex-wrap gap-1.5 px-3 pt-2.5 empty:hidden">
        <ComposerPrimitive.Attachments>{() => <ComposerAttachment />}</ComposerPrimitive.Attachments>
      </div>
      <div className="flex min-w-0 items-end gap-1 p-1.5">
        <ComposerPrimitive.AddAttachment asChild>
          <Button variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Attach files">
            <Paperclip />
          </Button>
        </ComposerPrimitive.AddAttachment>
        <ComposerPrimitive.Input
          rows={1}
          autoFocus={finePointer()}
          placeholder={placeholder ?? 'Message…'}
          aria-label="Message"
          className="max-h-[40vh] min-h-8 min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-base leading-[1.45] text-foreground outline-none placeholder:text-muted-foreground"
        />
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <Button size="icon-sm" className="shrink-0 rounded-lg" aria-label="Send">
              <ArrowUp />
            </Button>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
          <ComposerPrimitive.Cancel asChild>
            <Button size="icon-sm" variant="secondary" className="shrink-0 rounded-lg" aria-label="Stop">
              <Square className="fill-current" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </ComposerPrimitive.Root>
    <p className="mt-2 hidden items-center justify-center gap-1 text-xs text-muted-foreground sm:flex">
      <Kbd>Enter</Kbd> to send <span aria-hidden>·</span> <Kbd>Shift</Kbd>+<Kbd>Enter</Kbd> for a new line
    </p>
  </>
)

// ── thread ──────────────────────────────────────────────────────────────

export interface ThreadProps {
  title?: string
  subtitle?: string
  placeholder?: string
  /** History is loading for the selected session. */
  loading?: boolean
  notice?: ComposerNotice | null
  /** Passed to parts that post back to the server (A2UI surface actions). */
  sessionId?: string
  /** Older messages exist on the server: show "Load earlier messages". */
  hasMore?: boolean
  loadingEarlier?: boolean
  onLoadEarlier?: () => void
}

const ThreadSkeleton: FC = () => (
  <div className={cn(COLUMN, 'space-y-6 py-6')} aria-hidden>
    <div className="flex justify-end">
      <Skeleton className="h-10 w-2/5 rounded-2xl" />
    </div>
    <div className="space-y-2">
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  </div>
)

function usePartComponents() {
  useRegistryVersion() // re-render when plugins (un)register tool renderers
  const renderers = getToolRenderers() // identity changes only when the registry changes
  return useMemo(() => {
    const plugins = Object.fromEntries(Object.entries(renderers).map(([name, C]) => [name, guard(C)]))
    return {
      Text: TextPart,
      Reasoning,
      tools: { by_name: { aiui_ask: AskTool, ...plugins } as Record<string, ComponentType<ToolCallMessagePartProps>>, Fallback: ToolCard },
      data: {
        by_name: {
          element: ElementPart, references: ReferencesPart, memory: MemoryPart, a2ui: A2uiPart,
          [PENDING_APPROVAL]: PendingApprovalPart,
        },
      },
    }
  }, [renderers])
}

const MESSAGE_COMPONENTS = { UserMessage, AssistantMessage, SystemMessage }

export const Thread: FC<ThreadProps> = memo(({ title, subtitle, placeholder, loading, notice, sessionId, hasMore, loadingEarlier, onLoadEarlier }) => {
  const parts = usePartComponents()
  return (
    <SessionIdContext.Provider value={sessionId}>
    <PartsContext.Provider value={parts}>
    <ThreadPrimitive.Root className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <ThreadPrimitive.Viewport autoScroll className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-4 sm:px-6" data-aiui-thread>
        {loading ? (
          <ThreadSkeleton />
        ) : (
          <ThreadPrimitive.Empty>
            <div className={cn(COLUMN, 'flex flex-1 flex-col items-center justify-end gap-6 pt-10 pb-[12vh] text-center')} data-thread-empty>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">{title ?? 'How can I help you today?'}</h2>
                {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
              </div>
              <div className="grid w-full gap-2 text-left sm:grid-cols-2">
                <ThreadPrimitive.Suggestions>
                  {({ suggestion }) => (
                    <SuggestionPrimitive.Trigger send asChild>
                      <button
                        type="button"
                        className="min-w-0 rounded-xl border border-border px-4 py-3 text-left text-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="truncate font-medium text-foreground">{suggestion.title ?? suggestion.prompt}</div>
                        {suggestion.label && <div className="mt-0.5 truncate text-muted-foreground">{suggestion.label}</div>}
                      </button>
                    </SuggestionPrimitive.Trigger>
                  )}
                </ThreadPrimitive.Suggestions>
              </div>
            </div>
          </ThreadPrimitive.Empty>
        )}
        {hasMore && !loading && (
          <div className={cn(COLUMN, 'flex justify-center pt-4 pb-2')}>
            <Button type="button" variant="ghost" size="sm" disabled={loadingEarlier} onClick={onLoadEarlier} data-load-earlier>
              {loadingEarlier && <Spinner className="size-3.5" />}
              Load earlier messages
            </Button>
          </div>
        )}
        <ThreadPrimitive.Messages components={MESSAGE_COMPONENTS} />
        {/* Keeps the composer at the bottom of a short thread; an empty thread centres itself instead. */}
        <AuiIf condition={(st) => st.thread.messages.length > 0}>
          <div className="min-h-4 flex-1" aria-hidden />
        </AuiIf>
        <ThreadPrimitive.ViewportFooter className={cn(COLUMN, 'sticky bottom-0 bg-background pt-2 pb-3')}>
          <div className="relative">
            <ThreadPrimitive.ScrollToBottom asChild>
              <Button
                variant="outline"
                size="icon-sm"
                className="absolute -top-11 left-1/2 -translate-x-1/2 rounded-full bg-background shadow-sm disabled:invisible"
                aria-label="Jump to latest"
              >
                <ArrowDown />
              </Button>
            </ThreadPrimitive.ScrollToBottom>
          </div>
          <Composer placeholder={placeholder} notice={notice} />
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
    </PartsContext.Provider>
    </SessionIdContext.Provider>
  )
})
Thread.displayName = 'Thread'
