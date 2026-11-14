/**
 * Core block renderers: React + design tokens for the `_components` types
 * page handlers use most (praisonaiui/ui.py; dashboard.js renderComponent*).
 * Types not listed here (chart, board, gallery, pagination, dialog, popover,
 * html_embed, a2ui_surface, ...) render through LegacyBlockFallback.
 *
 * These are first-party contributions to the SDK block registry, not a
 * private table: the module registers every type with
 * `registerBlock(type, C, { fallback: true })` when the blocks chunk loads,
 * the call a plugin can make too. A plugin's plain `registerBlock` overrides
 * a core type, whichever loads first.
 *
 * Prop names follow the legacy dicts exactly, so existing page handlers work
 * unchanged. Text is always rendered as text (never as HTML).
 */
import {
  useEffect,
  useId,
  useState,
  type ComponentType,
  type CSSProperties,
  type FormEvent,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { ChevronRight, CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { Markdown } from '@/markdown/LazyMarkdown'
import type { ShellPage } from '@/sdk/manifest'
import { registerBlock, type BlockNode } from '@/sdk/registry'
import { BlockList } from './BlockRenderer'
import { InFrameContext, useBlockContext, useInFrame } from './context'
import { notify, type NotifyType } from '@/sdk/notify'
import { arr, display, isRecord, num, safeUrl, str, toBlockNodes } from './normalize'

export type CoreBlockProps = { node: BlockNode; page?: ShellPage }
type CoreBlock = ComponentType<CoreBlockProps>

function propsOf(node: BlockNode): Record<string, unknown> {
  return node.props ?? {}
}

/** Nested component list: `children` (normalised) or a legacy prop key. */
function childNodes(node: BlockNode, key?: string): BlockNode[] {
  if (Array.isArray(node.children)) return node.children
  return key ? toBlockNodes(arr(propsOf(node)[key])) : []
}

const FIELD_LABEL = 'text-sm font-medium text-foreground'
const META = 'text-xs text-muted-foreground'
// Auto-fitting tracks: as many equal columns as fit, stacking on narrow screens.
const AUTO_GRID = 'grid min-w-0 gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))]'
// The frame of a top-level panel. Inside another panel it is dropped (see
// InFrameContext): one hairline per group, never card-in-card.
const FRAME = 'rounded-xl border border-border'

/** Children of a framed block render flat. */
function InFrame({ children }: { children: ReactNode }) {
  return <InFrameContext.Provider value={true}>{children}</InFrameContext.Provider>
}

// ── text ─────────────────────────────────────────────────────────────

function TextBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  const text = str(p.content ?? p.text, typeof node.children === 'string' ? node.children : '')
  return <p className="min-w-0 whitespace-pre-wrap break-words text-base text-foreground">{text}</p>
}

function CaptionBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  return <p className={cn(META, 'min-w-0 break-words')}>{str(p.text ?? p.content)}</p>
}

const HEADING_SIZES = [
  'text-2xl font-semibold tracking-tight',
  'text-xl font-semibold tracking-tight',
  'text-lg font-semibold',
  'text-base font-semibold',
  'text-sm font-semibold',
  'text-sm font-medium text-muted-foreground',
]

function HeadingBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  const level = Math.min(6, Math.max(1, Math.round(num(p.level, 2))))
  const Tag = `h${level}` as 'h1'
  return (
    <Tag className={cn('min-w-0 break-words text-foreground', HEADING_SIZES[level - 1])}>
      {str(p.text ?? p.content ?? p.title, typeof node.children === 'string' ? node.children : '')}
    </Tag>
  )
}

function MarkdownBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  const content = str(p.content ?? p.text, typeof node.children === 'string' ? node.children : '')
  return <Markdown variant="docs" className="min-w-0">{content}</Markdown>
}

/** A fence longer than any backtick run inside the code. */
function fenced(code: string, language: string): string {
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  const lang = /^[\w#+.-]{1,32}$/.test(language) ? language : ''
  return `${fence}${lang}\n${code}\n${fence}`
}

function CodeBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  const code = str(p.code ?? p.content, typeof node.children === 'string' ? node.children : '')
  return (
    <div className="min-w-0" data-language={str(p.language)}>
      <Markdown variant="docs" className="min-w-0">{fenced(code, str(p.language))}</Markdown>
    </div>
  )
}

function JsonBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  let text: string
  try {
    text = JSON.stringify(p.data !== undefined ? p.data : { type: node.type, ...p }, null, 2)
  } catch {
    text = String(p.data)
  }
  return (
    <pre className="max-h-[28rem] min-w-0 overflow-auto rounded-lg bg-muted px-4 py-3 font-mono text-xs leading-relaxed text-foreground">
      {text}
    </pre>
  )
}

// ── panels and metrics ───────────────────────────────────────────────

function CardBlock({ node, page }: CoreBlockProps) {
  const p = propsOf(node)
  const title = str(p.title)
  const footer = str(p.footer)
  const kids = childNodes(node)
  const nested = useInFrame()
  return (
    <section
      data-nested={nested || undefined}
      className={cn('flex min-w-0 flex-col gap-1 text-card-foreground', !nested && FRAME, !nested && 'bg-card p-4')}
    >
      {title && <div className={cn(META, 'font-medium')}>{title}</div>}
      {p.value !== undefined && p.value !== null && (
        <div className="text-2xl font-semibold tabular-nums tracking-tight">{display(p.value)}</div>
      )}
      {footer && <div className={META}>{footer}</div>}
      {kids.length > 0 && (
        <div className="mt-2 flex min-w-0 flex-col gap-3">
          <InFrame>
            <BlockList nodes={kids} page={page} />
          </InFrame>
        </div>
      )}
    </section>
  )
}

function deltaTone(delta: unknown, mode: unknown): string {
  let sign = 0
  if (typeof delta === 'number') sign = Math.sign(delta)
  else if (typeof delta === 'string') sign = /^\s*[+↑]/.test(delta) ? 1 : /^\s*[-−↓]/.test(delta) ? -1 : 0
  if (mode === 'off' || sign === 0) return 'text-muted-foreground'
  if (mode === 'inverse') sign = -sign
  return sign > 0 ? 'text-success' : 'text-destructive'
}

function MetricBody({ p }: { p: Record<string, unknown> }) {
  const delta = p.delta
  const hasDelta = delta !== undefined && delta !== null && delta !== ''
  return (
    <>
      <div className={cn(META, 'truncate')}>{str(p.label ?? p.title)}</div>
      <div className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">{display(p.value)}</div>
      {hasDelta && <div className={cn('text-xs font-medium tabular-nums', deltaTone(delta, p.delta_color))}>{display(delta)}</div>}
    </>
  )
}

function MetricBlock({ node }: CoreBlockProps) {
  const nested = useInFrame()
  return (
    <div data-nested={nested || undefined} className={cn('flex min-w-0 flex-col gap-1', !nested && FRAME, !nested && 'p-4')}>
      <MetricBody p={propsOf(node)} />
    </div>
  )
}

/** One panel, cells separated by hairlines (gap-px over the border colour). */
function StatGroupBlock({ node }: CoreBlockProps) {
  const stats = arr(propsOf(node).stats).filter(isRecord)
  const nested = useInFrame()
  if (stats.length === 0) return null
  if (nested) {
    return (
      <div data-nested className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-4">
        {stats.map((s, i) => (
          <div key={i} className="flex min-w-0 flex-col gap-1">
            <MetricBody p={s} />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-px overflow-hidden rounded-xl border border-border bg-border">
      {stats.map((s, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-1 bg-background p-4">
          <MetricBody p={s} />
        </div>
      ))}
    </div>
  )
}

function ProgressBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  const max = num(p.max_value ?? p.max, 100) || 100
  const pct = Math.round(Math.min(100, Math.max(0, (num(p.value, 0) / max) * 100)))
  const label = str(p.label)
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="truncate text-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-label={label || 'Progress'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-1.5 overflow-hidden rounded-full bg-secondary"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-150 motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── layout ───────────────────────────────────────────────────────────

function ColumnsBlock({ node, page }: CoreBlockProps) {
  const p = propsOf(node)
  const kids = Array.isArray(node.children) ? node.children : toBlockNodes(arr(p.columns))
  return (
    <div className={AUTO_GRID}>
      {kids.map((child, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-4">
          <BlockList nodes={[child]} page={page} />
        </div>
      ))}
    </div>
  )
}

function RowBlock({ node, page }: CoreBlockProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-start gap-4">
      <BlockList nodes={childNodes(node, 'items')} page={page} />
    </div>
  )
}

function ContainerBlock({ node, page }: CoreBlockProps) {
  const title = str(propsOf(node).title)
  return (
    <section className="flex min-w-0 flex-col gap-4">
      {title && <h3 className="text-base font-semibold text-foreground">{title}</h3>}
      <BlockList nodes={childNodes(node)} page={page} />
    </section>
  )
}

function SeparatorBlock({ node }: CoreBlockProps) {
  const text = str(propsOf(node).text)
  if (!text) return <hr className="my-1 border-0 border-t border-border" />
  return (
    <div role="separator" className={cn(META, 'flex items-center gap-3')}>
      <span className="h-px flex-1 bg-border" />
      <span>{text}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

function TabsBlock({ node, page }: CoreBlockProps) {
  const items = arr(propsOf(node).items).filter(isRecord)
  const [active, setActive] = useState(0)
  const id = useId()
  if (items.length === 0) return null
  const current = Math.min(active, items.length - 1)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (current + step + items.length) % items.length
    setActive(next)
    document.getElementById(`${id}-tab-${next}`)?.focus()
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div role="tablist" className="flex min-w-0 gap-1 overflow-x-auto border-b border-border" onKeyDown={onKeyDown}>
        {items.map((item, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={i === current}
            aria-controls={`${id}-panel-${i}`}
            tabIndex={i === current ? 0 : -1}
            onClick={() => setActive(i)}
            className={cn(
              '-mb-px h-9 shrink-0 whitespace-nowrap rounded-t-md border-b-2 px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
              i === current ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {str(item.label, `Tab ${i + 1}`)}
          </button>
        ))}
      </div>
      {items.map((item, i) => (
        <div
          key={i}
          role="tabpanel"
          id={`${id}-panel-${i}`}
          aria-labelledby={`${id}-tab-${i}`}
          hidden={i !== current}
          className="flex min-w-0 flex-col gap-4"
        >
          <BlockList nodes={toBlockNodes(arr(item.children))} page={page} />
        </div>
      ))}
    </div>
  )
}

function Disclosure({
  title,
  open,
  children,
  className,
}: {
  title: string
  open?: boolean
  children: JSX.Element | JSX.Element[] | null
  className?: string
}) {
  return (
    <details open={open} className={cn('group min-w-0', className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-100 group-open:rotate-90 motion-reduce:transition-none"
        />
        <span className="min-w-0 truncate">{title}</span>
      </summary>
      <div className="flex min-w-0 flex-col gap-4 px-4 pb-4 pt-1">{children}</div>
    </details>
  )
}

function ExpanderBlock({ node, page }: CoreBlockProps) {
  const p = propsOf(node)
  const nested = useInFrame()
  return (
    <Disclosure title={str(p.title)} open={p.expanded === true} className={nested ? undefined : FRAME}>
      <InFrame>
        <BlockList nodes={childNodes(node)} page={page} />
      </InFrame>
    </Disclosure>
  )
}

function AccordionBlock({ node, page }: CoreBlockProps) {
  const items = arr(propsOf(node).items).filter(isRecord)
  const nested = useInFrame()
  if (items.length === 0) return null
  return (
    <div data-nested={nested || undefined} className={cn('min-w-0 divide-y divide-border', !nested && FRAME)}>
      {items.map((item, i) => (
        <Disclosure key={i} title={str(item.title)}>
          {typeof item.content === 'string' || typeof item.content === 'number' ? (
            <p className="whitespace-pre-wrap text-base text-foreground">{str(item.content)}</p>
          ) : (
            <InFrame>
              <BlockList nodes={toBlockNodes(arr(item.children ?? item.content))} page={page} />
            </InFrame>
          )}
        </Disclosure>
      ))}
    </div>
  )
}

// ── data ─────────────────────────────────────────────────────────────

function TableBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  const headers = arr(p.headers)
  const rows = arr(p.rows).map((r) => (Array.isArray(r) ? r : isRecord(r) ? headers.map((h) => r[str(h)]) : [r]))
  const rowIds = Array.isArray(p.row_ids) && p.row_ids.length === rows.length ? p.row_ids.map((x) => str(x)) : null
  const actions = rowIds ? arr(p.actions).map((a) => str(a)).filter(Boolean) : []
  const [selected, setSelected] = useState<string | null>(null)
  const nested = useInFrame()

  // Same bubbling DOM events as the legacy table (#336).
  const emit = (el: HTMLElement, name: string, detail: Record<string, unknown>) =>
    el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }))

  if (rows.length === 0 && headers.length === 0) return null
  return (
    <div data-nested={nested || undefined} className={cn('min-w-0 overflow-x-auto', !nested && FRAME)}>
      <table className="w-full border-collapse text-sm tabular-nums">
        {headers.length > 0 && (
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} scope="col" className="h-9 whitespace-nowrap px-3 text-left text-xs font-medium text-muted-foreground">
                  {display(h)}
                </th>
              ))}
              {actions.length > 0 && (
                <th scope="col" className="h-9 px-3">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, index) => {
            const rowId = rowIds?.[index]
            const isSelected = rowId !== undefined && rowId === selected
            const select = (el: HTMLElement) => {
              if (rowId === undefined) return
              setSelected(rowId)
              emit(el, 'aiui:table-select', { rowId, index })
            }
            return (
              <tr
                key={rowId ?? index}
                data-row-id={rowId}
                aria-selected={rowId !== undefined ? isSelected : undefined}
                tabIndex={rowId !== undefined ? 0 : undefined}
                onClick={rowId !== undefined ? (e) => select(e.currentTarget) : undefined}
                onKeyDown={
                  rowId !== undefined
                    ? (e) => {
                        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault()
                          select(e.currentTarget)
                        }
                      }
                    : undefined
                }
                className={cn(
                  'border-t border-border',
                  rowId !== undefined && 'cursor-pointer outline-none hover:bg-muted focus-visible:bg-muted',
                  isSelected && 'bg-accent text-accent-foreground hover:bg-accent',
                )}
              >
                {row.map((cell, i) => (
                  <td key={i} className="px-3 py-2 align-top text-foreground">
                    {display(cell)}
                  </td>
                ))}
                {actions.length > 0 && (
                  <td className="whitespace-nowrap px-3 py-1 text-right">
                    <div className="inline-flex gap-1">
                      {actions.map((action) => (
                        <Button
                          key={action}
                          type="button"
                          size="xs"
                          variant="ghost"
                          aria-label={`${action} ${display(row[0] ?? rowId)}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            emit(e.currentTarget, 'aiui:table-action', { action, rowId })
                          }}
                        >
                          {action}
                        </Button>
                      ))}
                    </div>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function KeyValueBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  const items = arr(p.items).filter(isRecord)
  const title = str(p.title)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {title && <div className="text-sm font-semibold text-foreground">{title}</div>}
      <dl className="min-w-0 divide-y divide-border">
        {items.map((item, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4 py-2 text-sm">
            <dt className="shrink-0 text-muted-foreground">{str(item.label ?? item.key)}</dt>
            <dd className="min-w-0 break-words text-right font-medium tabular-nums text-foreground">{display(item.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** `list`: strings → bullet list; `{label, value}` → key/value rows; components → stack. */
function ListBlock({ node, page }: CoreBlockProps) {
  const p = propsOf(node)
  const items = arr(p.items)
  if (items.length > 0 && items.every((it) => isRecord(it) && typeof it.type === 'string')) {
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <BlockList nodes={toBlockNodes(items)} page={page} />
      </div>
    )
  }
  if (items.length > 0 && items.every((it) => isRecord(it) && ('label' in it || 'key' in it))) {
    return <KeyValueBlock node={node} />
  }
  const ordered = p.ordered === true
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag
      className={cn(
        'min-w-0 space-y-1 pl-5 text-base text-foreground marker:text-muted-foreground',
        ordered ? 'list-decimal' : 'list-disc',
      )}
    >
      {items.map((it, i) => (
        <li key={i} className="break-words">
          {display(it)}
        </li>
      ))}
    </Tag>
  )
}

// ── status ───────────────────────────────────────────────────────────

const BADGE_VARIANTS = new Set(['default', 'secondary', 'destructive', 'outline'])

function BadgeBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  const v = str(p.variant, 'default')
  const variant = (BADGE_VARIANTS.has(v) ? v : v === 'error' ? 'destructive' : 'secondary') as
    | 'default'
    | 'secondary'
    | 'destructive'
    | 'outline'
  return (
    <div className="min-w-0">
      <Badge variant={variant}>{str(p.text ?? p.label)}</Badge>
    </div>
  )
}

type Tone = 'info' | 'success' | 'warning' | 'error'
const TONES: Record<Tone, { icon: LucideIcon; frame: string; icon_: string }> = {
  info: { icon: Info, frame: 'border-info/30 bg-info/10', icon_: 'text-info' },
  success: { icon: CircleCheck, frame: 'border-success/30 bg-success/10', icon_: 'text-success' },
  warning: { icon: TriangleAlert, frame: 'border-warning/30 bg-warning/10', icon_: 'text-warning' },
  error: { icon: CircleX, frame: 'border-destructive/30 bg-destructive/10', icon_: 'text-destructive' },
}

function toneOf(v: unknown): Tone {
  const s = str(v, 'info')
  if (s === 'danger' || s === 'destructive') return 'error'
  return s in TONES ? (s as Tone) : 'info'
}

function Callout({ tone, title, body }: { tone: Tone; title: string; body: string }) {
  const t = TONES[tone]
  const Icon = t.icon
  return (
    <div
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
      data-tone={tone}
      className={cn('flex min-w-0 gap-3 rounded-lg border px-4 py-3 text-sm', t.frame)}
    >
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', t.icon_)} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title && <div className="font-medium text-foreground">{title}</div>}
        {body && <div className="whitespace-pre-wrap break-words text-foreground/80">{body}</div>}
      </div>
    </div>
  )
}

function AlertBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  return <Callout tone={toneOf(p.variant)} title={str(p.title)} body={str(p.message ?? p.content)} />
}

function CalloutBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  return <Callout tone={toneOf(p.variant)} title={str(p.title)} body={str(p.content ?? p.message)} />
}

function EmptyBlock({ node }: CoreBlockProps) {
  return (
    <div className="flex min-w-0 items-center justify-center rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
      {str(propsOf(node).text, 'No data available')}
    </div>
  )
}

function SpinnerBlock({ node }: CoreBlockProps) {
  const text = str(propsOf(node).text)
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner aria-hidden role={undefined} />
      <span className={text ? undefined : 'sr-only'}>{text || 'Loading'}</span>
    </div>
  )
}

function SkeletonBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  const variant = str(p.variant, 'text')
  const style: CSSProperties = {}
  if (typeof p.width === 'string' || typeof p.width === 'number') style.width = p.width
  if (typeof p.height === 'string' || typeof p.height === 'number') style.height = p.height
  return (
    <Skeleton
      aria-hidden
      style={style}
      className={cn(variant === 'circle' ? 'size-10 rounded-full' : variant === 'rect' ? 'h-24 w-full' : 'h-4 w-full')}
    />
  )
}

/** `toast` blocks show a notification once when rendered (legacy parity). */
function ToastBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  const message = str(p.message)
  const v = str(p.variant, 'info')
  const kind: NotifyType = v === 'success' || v === 'warning' || v === 'error' ? v : 'info'
  useEffect(() => {
    // A stable id makes the StrictMode double effect a single toast.
    if (message) void notify(message, { type: kind, id: `aiui-block-toast:${kind}:${message}` })
  }, [kind, message])
  return null
}

// ── media and links ──────────────────────────────────────────────────

function ImageBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  const caption = str(p.caption)
  const width = str(p.width)
  const src = safeUrl(p.src ?? p.url, 'image')
  if (!src) return caption ? <p className={META}>{caption}</p> : null
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2">
      <img
        src={src}
        alt={str(p.alt)}
        loading="lazy"
        decoding="async"
        className="h-auto max-w-full rounded-lg"
        style={width ? { width } : undefined}
      />
      {caption && <figcaption className={META}>{caption}</figcaption>}
    </figure>
  )
}

function LinkBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  const href = safeUrl(p.href)
  const external = p.external === true
  if (!href) return <span className="w-fit text-sm text-foreground">{str(p.text)}</span>
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className="w-fit text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline"
    >
      {str(p.text, href)}
    </a>
  )
}

// ── actions ──────────────────────────────────────────────────────────

const BUTTON_VARIANTS = new Set(['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'])
type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'

/** `primary` → the filled default; no variant → outline (the legacy plain button). */
function buttonVariant(v: unknown): ButtonVariant {
  const s = str(v)
  if (s === 'primary') return 'default'
  return BUTTON_VARIANTS.has(s) ? (s as ButtonVariant) : 'outline'
}

/**
 * A button. `action` (string) POSTs `{...payload, action}` to the page's
 * action endpoint; `href` makes it a link. Without either it is inert, as on
 * the legacy dashboard.
 */
function ActionButton({ spec }: { spec: Record<string, unknown> }) {
  const ctx = useBlockContext()
  const [busy, setBusy] = useState(false)
  const label = str(spec.label ?? spec.text, 'Button')
  const variant = buttonVariant(spec.variant)
  const href = safeUrl(spec.href)
  if (href) {
    const external = spec.external === true
    return (
      <Button asChild size="sm" variant={variant}>
        <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
          {label}
        </a>
      </Button>
    )
  }
  const action = str(spec.action)
  const onClick = action
    ? async () => {
        setBusy(true)
        try {
          const payload = isRecord(spec.payload) ? spec.payload : {}
          await ctx.runAction({ body: { ...payload, action }, label })
        } finally {
          setBusy(false)
        }
      }
    : undefined
  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      disabled={busy || spec.disabled === true}
      aria-busy={busy || undefined}
      data-action={action || undefined}
      onClick={onClick}
    >
      {busy && <Spinner aria-hidden role={undefined} />}
      {label}
    </Button>
  )
}

function ButtonBlock({ node }: CoreBlockProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <ActionButton spec={propsOf(node)} />
    </div>
  )
}

function ButtonGroupBlock({ node }: CoreBlockProps) {
  const buttons = arr(propsOf(node).buttons).filter(isRecord)
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {buttons.map((b, i) => (
        <ActionButton key={i} spec={b} />
      ))}
    </div>
  )
}

// ── forms ────────────────────────────────────────────────────────────

/**
 * Collect values exactly like the legacy form_action, so inputs rendered by
 * the legacy fallback inside a React form are collected too.
 */
// eslint-disable-next-line react-refresh/only-export-components -- shared with tests
export function collectFormValues(form: HTMLFormElement): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  form.querySelectorAll<HTMLInputElement>('input, select, textarea').forEach((el) => {
    const key = el.name || el.dataset.label || el.getAttribute('aria-label') || ''
    if (!key) return
    if (el.type === 'radio') {
      if (el.checked) data[key] = el.value
      else if (!(key in data)) data[key] = null
    } else if (el.type === 'checkbox') {
      data[key] = el.checked
    } else {
      data[key] = el.value
    }
  })
  return data
}

function FormBlock({ node, page }: CoreBlockProps) {
  const p = propsOf(node)
  const ctx = useBlockContext()
  const [busy, setBusy] = useState(false)
  const submitLabel = str(p.submit_label, 'Submit')
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const body = collectFormValues(e.currentTarget)
    setBusy(true)
    try {
      await ctx.runAction({ body, label: submitLabel })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form data-action={str(p.action) || undefined} onSubmit={onSubmit} className="flex min-w-0 flex-col gap-4">
      <BlockList nodes={childNodes(node)} page={page} />
      <div>
        <Button type="submit" size="sm" disabled={busy} aria-busy={busy || undefined}>
          {busy && <Spinner aria-hidden role={undefined} />}
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: JSX.Element }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className={FIELD_LABEL}>
          {label}
        </label>
      )}
      {children}
    </div>
  )
}

function inputAttrs(p: Record<string, unknown>) {
  const label = str(p.label)
  return { name: str(p.name) || undefined, 'data-label': label || undefined, 'aria-label': label ? undefined : str(p.name) || undefined }
}

function TextInputBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  const id = useId()
  const type = node.type === 'number_input' ? 'number' : node.type === 'date_input' ? 'date' : node.type === 'time_input' ? 'time' : 'text'
  return (
    <Field id={id} label={str(p.label)}>
      <Input
        id={id}
        type={type}
        defaultValue={str(p.value)}
        placeholder={str(p.placeholder) || undefined}
        min={type === 'number' && p.min_val !== undefined ? str(p.min_val) : undefined}
        max={type === 'number' && p.max_val !== undefined ? str(p.max_val) : undefined}
        step={type === 'number' && p.step !== undefined ? str(p.step) : undefined}
        {...inputAttrs(p)}
      />
    </Field>
  )
}

function TextareaInputBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  const id = useId()
  return (
    <Field id={id} label={str(p.label)}>
      <Textarea
        id={id}
        rows={num(p.rows, 4)}
        defaultValue={str(p.value)}
        placeholder={str(p.placeholder) || undefined}
        {...inputAttrs(p)}
      />
    </Field>
  )
}

function optionList(v: unknown): { value: string; label: string }[] {
  return arr(v).map((o) =>
    isRecord(o) ? { value: str(o.value), label: str(o.label ?? o.value) } : { value: str(o), label: str(o) },
  )
}

function SelectInputBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  const id = useId()
  return (
    <Field id={id} label={str(p.label)}>
      <select
        id={id}
        defaultValue={str(p.value)}
        // Matches the Input primitive (design system: 32px controls; 16px text
        // on small screens so iOS does not zoom on focus).
        className="h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 text-[1rem] text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground"
        {...inputAttrs(p)}
      >
        {optionList(p.options).map((o, i) => (
          <option key={i} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

function CheckboxInputBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  return (
    <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-foreground">
      <input type="checkbox" defaultChecked={p.checked === true} className="size-4 accent-primary" {...inputAttrs(p)} />
      {str(p.label)}
    </label>
  )
}

function SwitchInputBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  return (
    <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm text-foreground">
      <input type="checkbox" role="switch" defaultChecked={p.checked === true} className="peer sr-only" {...inputAttrs(p)} />
      <span
        aria-hidden
        className="relative h-5 w-9 shrink-0 rounded-full bg-input transition-colors duration-100 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-background after:shadow-sm after:transition-transform after:duration-100 peer-checked:bg-primary peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:after:transition-none"
      />
      {str(p.label)}
    </label>
  )
}

function RadioInputBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  const fallbackName = useId()
  const name = str(p.name) || `radio-${fallbackName}`
  const label = str(p.label)
  const value = str(p.value)
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      {label && <legend className={cn(FIELD_LABEL, 'mb-1.5')}>{label}</legend>}
      {optionList(p.options).map((o, i) => (
        <label key={i} className="flex w-fit cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="radio"
            name={name}
            value={o.value}
            defaultChecked={o.value === value}
            data-label={label || undefined}
            className="size-4 accent-primary"
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  )
}

function SliderInputBlock({ node }: CoreBlockProps) {
  const p = propsOf(node)
  const id = useId()
  const [value, setValue] = useState(() => str(p.value, '0') || '0')
  return (
    <Field id={id} label={str(p.label)}>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          min={num(p.min_val, 0)}
          max={num(p.max_val, 100)}
          step={num(p.step, 1)}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-5 min-w-0 flex-1 accent-primary"
          {...inputAttrs(p)}
        />
        <output htmlFor={id} className="w-12 text-right text-sm tabular-nums text-foreground">
          {value}
        </output>
      </div>
    </Field>
  )
}

/** Block type → renderer. Aliases share a component. */
const CORE: Record<string, CoreBlock> = {
  text: TextBlock,
  caption: CaptionBlock,
  header: HeadingBlock,
  heading: HeadingBlock,
  markdown_text: MarkdownBlock,
  markdown: MarkdownBlock,
  code_block: CodeBlock,
  code: CodeBlock,
  json_view: JsonBlock,
  json: JsonBlock,
  card: CardBlock,
  metric: MetricBlock,
  stat: MetricBlock,
  stat_group: StatGroupBlock,
  progress_bar: ProgressBlock,
  progress: ProgressBlock,
  columns: ColumnsBlock,
  grid: ColumnsBlock,
  row: RowBlock,
  container: ContainerBlock,
  separator: SeparatorBlock,
  divider: SeparatorBlock,
  tabs: TabsBlock,
  expander: ExpanderBlock,
  accordion: AccordionBlock,
  table: TableBlock,
  key_value_list: KeyValueBlock,
  list: ListBlock,
  badge: BadgeBlock,
  alert: AlertBlock,
  callout: CalloutBlock,
  empty: EmptyBlock,
  spinner: SpinnerBlock,
  skeleton: SkeletonBlock,
  toast: ToastBlock,
  image_display: ImageBlock,
  image: ImageBlock,
  link: LinkBlock,
  button: ButtonBlock,
  action: ButtonBlock,
  button_group: ButtonGroupBlock,
  form_action: FormBlock,
  form: FormBlock,
  text_input: TextInputBlock,
  number_input: TextInputBlock,
  date_input: TextInputBlock,
  time_input: TextInputBlock,
  textarea_input: TextareaInputBlock,
  select_input: SelectInputBlock,
  checkbox_input: CheckboxInputBlock,
  switch_input: SwitchInputBlock,
  radio_input: RadioInputBlock,
  slider_input: SliderInputBlock,
}

/** Own-property lookup (a type named "constructor" must not hit Object.prototype). */
// eslint-disable-next-line react-refresh/only-export-components -- registry lookup
export function getCoreBlock(type: string): CoreBlock | undefined {
  return Object.prototype.hasOwnProperty.call(CORE, type) ? CORE[type] : undefined
}

export const CORE_BLOCK_TYPES: readonly string[] = Object.freeze(Object.keys(CORE).sort())

/**
 * Put the core blocks into the SDK registry as fallbacks. A type something
 * else already registered is left alone. Idempotent.
 */
// eslint-disable-next-line react-refresh/only-export-components -- registration helper
export function registerCoreBlocks(): void {
  for (const type of CORE_BLOCK_TYPES) registerBlock(type, CORE[type], { fallback: true })
}

// Runs when the (lazy) blocks chunk is evaluated, so the boot bundle never
// carries these components.
registerCoreBlocks()
