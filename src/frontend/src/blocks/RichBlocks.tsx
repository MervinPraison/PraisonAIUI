/**
 * Lazy-loaded rich UI blocks:
 *   - `stepper`      — multi-step workflow / agent pipeline progress
 *   - `timeline`     — chronological vertical activity & audit feed
 *   - `diff_viewer`  — line-by-line unified diff viewer (code / prompt versions)
 *   - `tree_view`    — collapsible hierarchical tree (RAG sources / files)
 *   - `copy_field`   — copyable command / API key pill with secret mask toggle
 *   - `rating_input` — accessible star rating (display or interactive form input)
 *
 * Loaded lazily on first use from coreBlocks.tsx, keeping boot and chat-route
 * chunks untouched (R4, R10). Tokens only (DESIGN.md); safe React escaping (R9).
 */
import { useEffect, useId, useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { Check, ChevronRight, CircleX, Copy, Eye, EyeOff, Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { CoreBlockProps } from './coreBlocks'
import { computeLineDiff } from './diffModel'
import { fieldOf, FIELD_LABEL } from './inputs/fieldProps'
import { HiddenValue } from './inputs/shared'
import { arr, isRecord, num, safeUrl, str } from './normalize'

// ── 1. Stepper ────────────────────────────────────────────────────────────────

const STEP_STATES = new Set(['pending', 'active', 'done', 'error'])

export function StepperBlock({ node }: CoreBlockProps): JSX.Element {
  const p = node.props ?? {}
  const steps = arr(p.steps).filter(isRecord)
  const active = Math.max(0, Math.floor(num(p.active, 0)))
  const vertical = str(p.orientation, 'horizontal') === 'vertical'

  return (
    <ol
      data-aiui-stepper=""
      aria-label={str(p.title, 'Progress steps')}
      className={cn(
        'flex min-w-0 gap-3',
        vertical ? 'flex-col' : 'flex-col sm:flex-row sm:items-start sm:justify-between',
      )}
    >
      {steps.map((step, idx) => {
        const rawState = str(step.status)
        const state = STEP_STATES.has(rawState)
          ? rawState
          : idx < active
            ? 'done'
            : idx === active
              ? 'active'
              : 'pending'
        const title = str(step.title, `Step ${idx + 1}`)
        const desc = str(step.description)
        const isLast = idx === steps.length - 1
        return (
          <li
            key={str(step.id) || idx}
            aria-current={state === 'active' ? 'step' : undefined}
            data-step-state={state}
            className={cn('flex min-w-0 gap-2.5', !vertical && 'flex-1 sm:items-start')}
          >
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums',
                state === 'done' && 'bg-success-soft text-success',
                state === 'active' && 'bg-primary text-primary-foreground ring-2 ring-ring',
                state === 'error' && 'bg-danger-soft text-destructive',
                state === 'pending' && 'bg-fill-3 text-tier-3',
              )}
            >
              {state === 'done' ? (
                <Check className="size-3.5" />
              ) : state === 'error' ? (
                <CircleX className="size-3.5" />
              ) : (
                idx + 1
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className={cn('text-sm font-medium', state === 'pending' ? 'text-tier-3' : 'text-tier-1')}>
                {title}
              </div>
              {desc && <p className="mt-0.5 text-xs text-tier-3">{desc}</p>}
            </div>
            {!vertical && !isLast && (
              <div
                aria-hidden="true"
                className={cn(
                  'mt-3 hidden h-px flex-1 sm:block',
                  state === 'done' ? 'bg-success' : 'bg-border',
                )}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ── 2. Timeline ───────────────────────────────────────────────────────────────

const DOT_TONES: Record<string, string> = {
  default: 'bg-fill-3',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  error: 'bg-danger-soft text-destructive',
}

export function TimelineBlock({ node }: CoreBlockProps): JSX.Element {
  const p = node.props ?? {}
  const title = str(p.title)
  const items = arr(p.items).filter(isRecord)

  return (
    <div data-aiui-timeline="" className="flex min-w-0 flex-col gap-3">
      {title && <h3 className="text-sm font-medium text-tier-1">{title}</h3>}
      <ol className="flex min-w-0 flex-col gap-3 border-l border-hairline pl-3">
        {items.map((item, idx) => {
          const toneKey = str(item.status, 'default')
          const dotClass = Object.prototype.hasOwnProperty.call(DOT_TONES, toneKey)
            ? DOT_TONES[toneKey]
            : DOT_TONES.default
          const itemTitle = str(item.title, `Event ${idx + 1}`)
          const desc = str(item.description)
          const ts = str(item.timestamp)
          const badge = str(item.badge)
          return (
            <li key={str(item.id) || idx} className="flex min-w-0 items-start gap-2.5">
              <span
                aria-hidden="true"
                className={cn(
                  'mt-1.5 size-2 shrink-0 rounded-full border border-hairline',
                  dotClass,
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-sm font-medium text-tier-1">{itemTitle}</span>
                    {badge && <Badge variant="secondary">{badge}</Badge>}
                  </div>
                  {ts && <time className="text-xs text-tier-3 tabular-nums">{ts}</time>}
                </div>
                {desc && <p className="mt-1 text-xs text-tier-2">{desc}</p>}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ── 3. Diff Viewer ────────────────────────────────────────────────────────────

export function DiffViewerBlock({ node }: CoreBlockProps): JSX.Element {
  const p = node.props ?? {}
  const title = str(p.title)
  const before = str(p.before)
  const after = str(p.after)
  const beforeLabel = str(p.before_label, 'Before')
  const afterLabel = str(p.after_label, 'After')
  const diff = useMemo(() => computeLineDiff(before, after), [before, after])

  return (
    <div data-aiui-diff="" className="min-w-0 overflow-hidden rounded-xl border border-hairline bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-fill-4 px-3 py-2 text-xs">
        <div className="flex min-w-0 items-center gap-2 font-medium text-tier-1">
          <span>{title || `${beforeLabel} → ${afterLabel}`}</span>
          {title && (
            <span className="text-tier-3">
              ({beforeLabel} → {afterLabel})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 tabular-nums">
          <Badge variant="outline" className="text-success">
            +{diff.added}
          </Badge>
          <Badge variant="outline" className="text-destructive">
            -{diff.removed}
          </Badge>
        </div>
      </div>
      <div className="min-w-0 overflow-x-auto font-mono text-xs leading-relaxed">
        {diff.lines.length === 0 ? (
          <p className="px-3 py-4 font-sans text-tier-3">No content to compare.</p>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {diff.lines.map((line, i) => (
                <tr
                  key={i}
                  data-diff-kind={line.kind}
                  className={cn(
                    line.kind === 'add' && 'bg-success-soft text-tier-1',
                    line.kind === 'del' && 'bg-danger-soft text-tier-1',
                    line.kind === 'same' && 'text-tier-2',
                  )}
                >
                  <td className="select-none border-r border-border px-2 text-right text-tier-4 tabular-nums">
                    {line.oldLine ?? ''}
                  </td>
                  <td className="select-none border-r border-border px-2 text-right text-tier-4 tabular-nums">
                    {line.newLine ?? ''}
                  </td>
                  <td className="select-none px-1.5 text-center font-medium">
                    {line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}
                  </td>
                  <td className="whitespace-pre-wrap px-2">{line.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {diff.truncated && (
        <p className="border-t border-hairline px-3 py-1.5 text-xs text-tier-3">
          Diff truncated to the first 400 lines per side.
        </p>
      )}
    </div>
  )
}

// ── 4. Tree View ──────────────────────────────────────────────────────────────

const MAX_TREE_DEPTH = 12

function TreeNodeRow({
  item,
  depth,
  defaultExpanded,
}: {
  item: Record<string, unknown>
  depth: number
  defaultExpanded: boolean
}): JSX.Element {
  const panelId = useId()
  const children = depth < MAX_TREE_DEPTH ? arr(item.children).filter(isRecord) : []
  const hasChildren = children.length > 0
  const [open, setOpen] = useState(() => (typeof item.expanded === 'boolean' ? item.expanded : defaultExpanded))
  const label = str(item.label, 'Item')
  const badge = str(item.badge)
  const href = safeUrl(str(item.href))

  return (
    <li className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-row-hover">
        {hasChildren ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
            onClick={() => setOpen((v) => !v)}
            className="flex size-6 shrink-0 items-center justify-center rounded-xs text-tier-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn('size-3.5 transition-transform', open && 'rotate-90')}
            />
          </button>
        ) : (
          <span aria-hidden="true" className="size-6 shrink-0" />
        )}
        {href ? (
          <a href={href} className="min-w-0 truncate text-sm text-link underline-offset-2 hover:underline">
            {label}
          </a>
        ) : (
          <span className="min-w-0 truncate text-sm text-tier-1">{label}</span>
        )}
        {badge && (
          <Badge variant="secondary" className="ml-auto shrink-0">
            {badge}
          </Badge>
        )}
      </div>
      {hasChildren && open && (
        <ul id={panelId} className="border-l border-hairline pl-4">
          {children.map((child, i) => (
            <TreeNodeRow
              key={str(child.id) || i}
              item={child}
              depth={depth + 1}
              defaultExpanded={defaultExpanded}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export function TreeViewBlock({ node }: CoreBlockProps): JSX.Element {
  const p = node.props ?? {}
  const title = str(p.title)
  const nodes = arr(p.nodes).filter(isRecord)
  const defaultExpanded = p.default_expanded === true

  return (
    <div data-aiui-tree="" className="flex min-w-0 flex-col gap-2 rounded-xl border border-hairline p-3">
      {title && <h3 className="text-sm font-medium text-tier-1">{title}</h3>}
      {nodes.length === 0 ? (
        <p className="text-xs text-tier-3">No items.</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-0.5">
          {nodes.map((item, i) => (
            <TreeNodeRow
              key={str(item.id) || i}
              item={item}
              depth={0}
              defaultExpanded={defaultExpanded}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

// ── 5. Copy Field ─────────────────────────────────────────────────────────────

// Track last live-region message across instances so VoiceOver announces repeats.
let lastCopyAnnouncement = ''

export function CopyFieldBlock({ node }: CoreBlockProps): JSX.Element {
  const p = node.props ?? {}
  const value = str(p.value)
  const label = str(p.label)
  const secret = p.secret === true
  const [revealed, setRevealed] = useState(!secret)
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [liveText, setLiveText] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const labelId = useId()

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const announce = (ok: boolean) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    let msg = ok ? 'Copied' : 'Copy failed'
    if (msg === lastCopyAnnouncement) msg += '\u00A0'
    lastCopyAnnouncement = msg
    setStatus(ok ? 'copied' : 'failed')
    setLiveText(msg)
    timerRef.current = setTimeout(() => {
      setStatus('idle')
      setLiveText('')
    }, 2000)
  }

  const handleCopy = async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      announce(true)
    } catch {
      announce(false)
    }
  }

  const shown = revealed ? value : '•'.repeat(Math.min(Math.max(value.length, 8), 24))
  const copyAria = label ? `Copy ${label}` : 'Copy value'

  return (
    <div data-aiui-copy-field="" className="flex min-w-0 flex-col gap-1.5">
      {label && (
        <span id={labelId} className={FIELD_LABEL}>
          {label}
        </span>
      )}
      <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-input bg-fill-4 px-2.5 py-1.5">
        <code
          aria-labelledby={label ? labelId : undefined}
          className="min-w-0 flex-1 truncate font-mono text-xs text-tier-1"
        >
          {shown}
        </code>
        {secret && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={revealed ? `Hide ${label || 'value'}` : `Reveal ${label || 'value'}`}
            onClick={() => setRevealed((v) => !v)}
          >
            {revealed ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={copyAria}
          data-copied={status === 'copied' ? '' : undefined}
          data-failed={status === 'failed' ? '' : undefined}
          onClick={() => void handleCopy()}
        >
          {status === 'copied' ? (
            <Check aria-hidden="true" className="text-success" />
          ) : (
            <Copy aria-hidden="true" />
          )}
        </Button>
        {/* Live region stays outside the button so screen readers announce status reliably. */}
        <span
          role="status"
          className={cn(
            'text-xs transition-opacity',
            status === 'idle' ? 'sr-only opacity-0' : 'opacity-100',
            status === 'copied' && 'text-success',
            status === 'failed' && 'text-destructive',
          )}
        >
          {liveText}
        </span>
      </div>
    </div>
  )
}

// ── 6. Rating Input ───────────────────────────────────────────────────────────

export function RatingInputBlock({ node }: CoreBlockProps): JSX.Element {
  const p = node.props ?? {}
  const f = fieldOf(p)
  const maxStars = Math.min(10, Math.max(1, Math.floor(num(p.max_stars, 5))))
  const readonly = p.readonly === true
  const [rating, setRating] = useState(() => Math.min(maxStars, Math.max(0, Math.floor(num(p.value, 0)))))
  const labelId = useId()

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (readonly) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      setRating((r) => Math.min(maxStars, r + 1))
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      setRating((r) => Math.max(0, r - 1))
    }
  }

  return (
    <div
      data-aiui-rating=""
      data-auto-submit={f.autoSubmit}
      className="flex min-w-0 flex-col gap-1.5"
    >
      {f.label && (
        <span id={labelId} className={FIELD_LABEL}>
          {f.label}
        </span>
      )}
      {!readonly && <HiddenValue name={f.name} label={f.label} value={String(rating)} />}
      <div
        role={readonly ? 'img' : 'radiogroup'}
        aria-labelledby={f.label ? labelId : undefined}
        aria-label={readonly ? `${rating} out of ${maxStars} stars` : f.label ? undefined : 'Rating'}
        onKeyDown={onKeyDown}
        className="flex items-center gap-1"
      >
        {Array.from({ length: maxStars }, (_, i) => {
          const val = i + 1
          const filled = val <= rating
          if (readonly) {
            return (
              <Star
                key={val}
                aria-hidden="true"
                className={cn('size-4', filled ? 'fill-current text-warning' : 'text-tier-4')}
              />
            )
          }
          return (
            <button
              key={val}
              type="button"
              role="radio"
              aria-checked={rating === val}
              aria-label={`${val} of ${maxStars} stars`}
              onClick={() => setRating((cur) => (cur === val ? 0 : val))}
              className="flex size-6 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Star
                aria-hidden="true"
                className={cn(
                  'size-4 transition-colors',
                  filled ? 'fill-current text-warning' : 'text-tier-4 hover:text-warning',
                )}
              />
            </button>
          )
        })}
        <span className="ml-2 text-xs text-tier-3 tabular-nums">
          {rating}/{maxStars}
        </span>
      </div>
    </div>
  )
}

const RICH_MAP: Record<string, (props: CoreBlockProps) => JSX.Element> = {
  stepper: StepperBlock,
  timeline: TimelineBlock,
  diff_viewer: DiffViewerBlock,
  tree_view: TreeViewBlock,
  copy_field: CopyFieldBlock,
  rating_input: RatingInputBlock,
}

export default function RichBlock(props: CoreBlockProps): JSX.Element {
  const Impl = RICH_MAP[props.node.type]
  return Impl ? <Impl {...props} /> : <></>
}
