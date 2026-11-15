/**
 * The plain-language step tracker (Guided Studio's `turnHeader` region,
 * chunk `lf-step-tracker`): above each assistant turn, "Here is what
 * Researcher did", its numbered steps in plain words with a short result
 * each, "All done in 3 seconds", and a "Show details" disclosure with the
 * raw calls (tool, what it ran, what came back, how long).
 *
 * It reads the turn from the `chat` layout feed (builtin.chat) by message
 * id; without the feed, or for a reply that is only text, it renders
 * nothing. Loaded with import() by the layout that names it, never before an
 * assistant turn is on screen.
 */
import { useId, useMemo, useState, useSyncExternalStore, type JSX } from 'react'
import { Check, ChevronDown, Hand, Minus, SquareTerminal, X } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { useLayoutData, type TurnRegionProps } from '@/sdk/layouts'
import type { ChatMessageView, ChatState } from '@/sdk/layoutTypes'
import { cn } from '@/lib/utils'
import { deriveSteps, formatSeconds, hasWork, stepMeta, summarize, type PlainStep } from './labels'

const EMPTY: ChatState = Object.freeze({ sessionId: null, messages: [], isRunning: false })
const noSubscribe = () => () => {}
const empty = () => EMPTY

/** The turn with this id from the chat feed (null while there is no feed or no such turn). */
function useTurn(messageId: string): ChatMessageView | null {
  const feed = useLayoutData('chat')
  const read = feed ? feed.get : empty
  const state = useSyncExternalStore(feed ? feed.subscribe : noSubscribe, read, read)
  return state.messages.find((m) => m.id === messageId) ?? null
}

function StepIcon({ status, small }: { status: PlainStep['status']; small: boolean }) {
  const box = cn('flex shrink-0 items-center justify-center rounded-full', small ? 'size-[26px]' : 'size-7')
  const icon = small ? 'size-[15px]' : 'size-4'
  if (status === 'running') {
    return (
      <span className={cn(box, 'bg-accent-soft text-link')}>
        <Spinner aria-label="Working" className={icon} />
      </span>
    )
  }
  const look =
    status === 'done' ? ['bg-primary text-primary-foreground', Check]
      : status === 'waiting' ? ['bg-warning-soft text-warning', Hand]
        : status === 'error' ? ['bg-danger-soft text-destructive', X]
          : ['bg-muted text-muted-foreground', Minus]
  const [tone, Icon] = look as [string, typeof Check]
  return (
    <span className={cn(box, tone)} aria-hidden="true">
      <Icon className={icon} strokeWidth={3} />
    </span>
  )
}

function Details({ steps }: { steps: readonly PlainStep[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 border-t border-border p-0 pt-3 text-sm text-muted-foreground" data-step-details>
      {steps.map((s) => {
        const took = s.durationMs !== undefined ? formatSeconds(s.durationMs) : ''
        if (s.kind === 'reasoning') {
          return (
            <li key={s.id} className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-foreground">Reasoning</span>
                {took && <span>Thought for {took}</span>}
              </span>
              {s.detail?.text && <p className="m-0 whitespace-pre-wrap break-words">{s.detail.text}</p>}
            </li>
          )
        }
        if (s.kind === 'text') return null
        return (
          <li key={s.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-xl bg-muted px-3 py-2.5 font-mono text-[13px]">
            <SquareTerminal aria-hidden="true" className="size-4 shrink-0" />
            <span>{s.detail?.tool}</span>
            {s.detail?.input && <span className="min-w-0 break-all text-foreground">{s.detail.input}</span>}
            {s.detail?.output && <span className="min-w-0 break-all">→ {s.detail.output}</span>}
            <span className="ml-auto font-sans font-bold text-link">
              {stepMeta({ ...s, meta: undefined })}
              {took && ` · ${took}`}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export default function StepTracker({ messageId, viewport }: TurnRegionProps): JSX.Element | null {
  const message = useTurn(messageId)
  const steps = useMemo(() => (message && message.role === 'assistant' ? deriveSteps(message) : []), [message])
  const [open, setOpen] = useState(false)
  const id = useId()
  if (!message || !hasWork(steps)) return null
  const summary = summarize(message, steps)
  const phone = viewport === 'phone'
  const toggle = (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? `${id}-details` : undefined}
      onClick={() => setOpen((v) => !v)}
      className={cn(
        'flex items-center gap-1.5 rounded-lg border-0 bg-transparent text-sm font-bold text-link outline-none hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-ring',
        phone ? 'min-h-11 px-1' : '-ml-2.5 min-h-9 self-start px-2.5',
      )}
    >
      {open ? 'Hide details' : 'Show details'}
      <ChevronDown aria-hidden="true" className={cn('size-4 motion-safe:transition-transform', open && 'rotate-180')} />
    </button>
  )
  return (
    <section
      aria-label={summary.title.replace(/^Here is what/, 'What')}
      data-step-tracker={summary.state}
      className={cn('mb-4 flex flex-col rounded-[18px] border border-border bg-card text-card-foreground shadow-sm', phone ? 'gap-2 px-3.5 pt-3 pb-1.5' : 'gap-3 px-[18px] py-4')}
    >
      {!phone && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="m-0 text-[15px] font-bold text-muted-foreground">{summary.title}</h3>
          <span className="text-sm text-tier-3" role="status">{summary.status}</span>
        </div>
      )}
      <ol className={cn('m-0 flex list-none p-0', phone ? 'flex-col gap-2' : 'flex-wrap gap-x-[22px] gap-y-2.5')}>
        {steps.map((s, i) => (
          <li
            key={s.id}
            data-step={s.kind}
            data-status={s.status}
            className={cn('flex min-w-0 items-center gap-2.5', !phone && 'flex-[1_1_180px]')}
          >
            <StepIcon status={s.status} small={phone} />
            {phone ? (
              <>
                <span className="min-w-0 flex-1 text-[15px] font-bold">
                  <span className="text-tier-3">{i + 1} </span>
                  {s.label}
                </span>
                <span className="max-w-[45%] shrink-0 truncate text-[13px] text-tier-3">{s.meta ?? stepMeta(s)}</span>
              </>
            ) : (
              <span className="flex min-w-0 flex-col leading-[1.3]">
                <span className="text-[15px] font-bold break-words">
                  <span className="text-tier-3">{i + 1} </span>
                  {s.label}
                </span>
                <span className="truncate text-[13px] text-tier-3">{stepMeta(s)}</span>
              </span>
            )}
          </li>
        ))}
      </ol>
      {open && (
        <div id={`${id}-details`}>
          <Details steps={steps} />
        </div>
      )}
      {phone ? (
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-tier-3" role="status">{summary.status}</span>
          {toggle}
        </div>
      ) : (
        toggle
      )}
    </section>
  )
}
