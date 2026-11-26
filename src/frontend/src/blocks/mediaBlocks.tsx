/**
 * Media, navigation and overlay blocks: `avatar`, `audio_player`,
 * `video_player`, `file_download`, `breadcrumb`, `tooltip_wrap`, `popover`, `dialog`, `card_grid`, and the `link` renderer
 * (text link, button-styled link, in-app page link). Same dict shapes as
 * praisonaiui/ui.py; coreBlocks.tsx adds them to the core set.
 *
 * Components are function declarations and the table is built by a function
 * (mediaBlocks()), so coreBlocks can read it while the import cycle through
 * BlockRenderer is still resolving.
 */
import { useMemo, type CSSProperties, type JSX, type KeyboardEvent, type MouseEvent } from 'react'
import { Download } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ShellPage } from '@/sdk/manifest'
import type { BlockNode } from '@/sdk/registry'
import { BlockList } from './BlockRenderer'
import { hrefLinkOnClick, initials, pageLinkProps } from './mediaModel'
import { arr, display, isRecord, num, safeUrl, str, toBlockNode, toBlockNodes } from './normalize'

type Props = { node: BlockNode; page?: ShellPage }
type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

const META = 'text-xs text-muted-foreground'
const FOCUS = 'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const BUTTON_VARIANTS = new Set(['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'])
const BADGE_VARIANTS = new Set(['default', 'secondary', 'destructive', 'outline'])
// Child types that take focus themselves: a tooltip around them adds no tab stop.
const INTERACTIVE = /^(button|action|link|file_download|dialog|popover|button_group|form|form_action|.*_input)$/

const propsOf = (node: BlockNode): Record<string, unknown> => node.props ?? {}
const kidsOf = (node: BlockNode) => (Array.isArray(node.children) ? node.children : toBlockNodes(arr(propsOf(node).children)))

/** `primary` → the filled default; anything unknown → outline. */
function buttonVariant(v: unknown): ButtonVariant {
  const s = str(v)
  return s === 'primary' ? 'default' : BUTTON_VARIANTS.has(s) ? (s as ButtonVariant) : 'outline'
}

function badgeVariant(v: unknown): BadgeVariant {
  const s = str(v, 'secondary')
  return s === 'error' || s === 'danger' ? 'destructive' : BADGE_VARIANTS.has(s) ? (s as BadgeVariant) : 'secondary'
}

type LinkAttrs = { href: string; target?: string; rel?: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void }

/** Link attributes for `{href, target, external}` or `{page, params}` (an app page id); null without a safe target. */
function linkAttrs(spec: Record<string, unknown>): LinkAttrs | null {
  const page = str(spec.page)
  if (page) return pageLinkProps(page, isRecord(spec.params) ? spec.params : undefined)
  const href = safeUrl(spec.href)
  if (!href) return null
  const target = spec.external === true ? '_blank' : str(spec.target) || undefined
  return {
    href,
    target,
    rel: target === '_blank' ? 'noopener noreferrer' : undefined,
    onClick: target ? undefined : hrefLinkOnClick(href),
  }
}

// ── links ────────────────────────────────────────────────────────────

const asButton = (variant: unknown, a: JSX.Element) => (
  <div className="flex min-w-0">
    <Button asChild size="sm" variant={buttonVariant(variant)}>{a}</Button>
  </div>
)

/** `link`: a text link, or a button-styled one with `variant` (`link_button`); `page` opens an app page in place (`page_link`). */
export function LinkBlock({ node }: Props) {
  const p = propsOf(node)
  const attrs = linkAttrs(p)
  const text = str(p.text ?? p.label, attrs?.href ?? '')
  if (!attrs) return <span className="w-fit text-sm text-foreground">{text}</span>
  if (str(p.variant)) return asButton(p.variant, <a {...attrs}>{text}</a>)
  return (
    <a {...attrs} className="w-fit text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline">
      {text}
    </a>
  )
}

function FileDownloadBlock({ node }: Props) {
  const p = propsOf(node)
  const href = safeUrl(p.href)
  if (!href) return null
  return asButton(
    p.variant,
    <a href={href} download={str(p.filename)}>
      <Download aria-hidden />
      {str(p.label, 'Download')}
    </a>,
  )
}

// ── media ────────────────────────────────────────────────────────────

function BlockAvatar({ src, name, fallback, size }: { src?: string; name: string; fallback?: string; size?: string }) {
  const text = (fallback || initials(name)).slice(0, 2)
  const sz = size === 'sm' || size === 'lg' ? size : 'default'
  return (
    <Avatar size={sz} role="img" aria-label={name || text}>
      {src && <AvatarImage src={src} alt="" />}
      <AvatarFallback aria-hidden className="font-medium">{text}</AvatarFallback>
    </Avatar>
  )
}

function AvatarBlock({ node }: Props) {
  const p = propsOf(node)
  return <BlockAvatar src={safeUrl(p.src, 'image')} name={str(p.name)} fallback={str(p.fallback) || undefined} size={str(p.size)} />
}

/** `audio_player` / `video_player`: native controls, an optional caption (`title`). */
function PlayerBlock({ node }: Props) {
  const p = propsOf(node)
  const src = safeUrl(p.src)
  const title = str(p.title)
  if (!src) return null
  const autoplay = p.autoplay === true
  const player =
    node.type === 'video_player' ? (
      // Browsers only autoplay muted video.
      <video controls playsInline preload="metadata" src={src} poster={safeUrl(p.poster, 'image')} autoPlay={autoplay} muted={autoplay} aria-label={title || 'Video'} className="h-auto w-full max-w-3xl rounded-lg bg-muted" />
    ) : (
      <audio controls preload="metadata" src={src} autoPlay={autoplay} aria-label={title || 'Audio'} className="w-full max-w-xl" />
    )
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-2">
      {player}
      {title && <figcaption className={META}>{title}</figcaption>}
    </figure>
  )
}

// ── navigation ───────────────────────────────────────────────────────

function BreadcrumbBlock({ node }: Props) {
  const items = arr(propsOf(node).items).filter(isRecord)
  if (items.length === 0) return null
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList>
        {items.map((item, i) => {
          const attrs = i === items.length - 1 ? null : linkAttrs(item)
          const label = str(item.label ?? item.text)
          return [
            i > 0 && <BreadcrumbSeparator key={`s${i}`} />,
            <BreadcrumbItem key={i} className="min-w-0">
              {attrs ? (
                <BreadcrumbLink asChild><a {...attrs} className={cn('rounded-sm', FOCUS)}>{label}</a></BreadcrumbLink>
              ) : (
                <BreadcrumbPage className="truncate">{label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>,
          ]
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

// ── overlays ─────────────────────────────────────────────────────────

/** `tooltip_wrap`: the child block with a tooltip on hover and on focus. */
function TooltipBlock({ node, page }: Props) {
  const p = propsOf(node)
  const child = useMemo(() => toBlockNode(p.child), [p.child])
  const kids = child ? [child] : []
  const content = str(p.content)
  if (!content) return <BlockList nodes={kids} page={page} />
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={child && INTERACTIVE.test(child.type) ? undefined : 0} className={cn('inline-flex w-fit max-w-full rounded-md', FOCUS)}>
          <BlockList nodes={kids} page={page} />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{content}</TooltipContent>
    </Tooltip>
  )
}

function activateOnKey(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Enter' && e.key !== ' ') return
  e.preventDefault()
  e.currentTarget.click()
}

/** `popover`: the trigger block opens a panel of child blocks. A `button` trigger is drawn as a button. */
function PopoverBlock({ node, page }: Props) {
  const p = propsOf(node)
  const trigger = useMemo(() => toBlockNode(p.trigger), [p.trigger])
  const tp = trigger?.props ?? {}
  return (
    <div className="flex min-w-0">
      <Popover>
        <PopoverTrigger asChild>
          {!trigger || trigger.type === 'button' || trigger.type === 'action' ? (
            <Button type="button" size="sm" variant={buttonVariant(tp.variant)}>
              {str(tp.label ?? tp.text, 'More')}
            </Button>
          ) : (
            <span role="button" tabIndex={0} onKeyDown={activateOnKey} className={cn('inline-flex w-fit max-w-full cursor-pointer rounded-md', FOCUS)}>
              <BlockList nodes={[trigger]} page={page} />
            </span>
          )}
        </PopoverTrigger>
        <PopoverContent className="flex max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-y-auto">
          <BlockList nodes={kidsOf(node)} page={page} />
        </PopoverContent>
      </Popover>
    </div>
  )
}

/** `dialog`: a button (`trigger_label`, else the title) that opens a modal with the child blocks. */
function DialogBlock({ node, page }: Props) {
  const p = propsOf(node)
  const title = str(p.title, 'Dialog')
  const description = str(p.description)
  return (
    <div className="flex min-w-0">
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button" size="sm" variant={buttonVariant(p.variant)}>
            {str(p.trigger_label, title)}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl" {...(description ? {} : { 'aria-describedby': undefined })}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="flex min-w-0 flex-col gap-4">
            <BlockList nodes={kidsOf(node)} page={page} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── card grid ────────────────────────────────────────────────────────

function EntityCard({ item }: { item: Record<string, unknown> }) {
  const title = str(item.title ?? item.name)
  const subtitle = str(item.subtitle)
  const description = str(item.description)
  const image = safeUrl(item.image, 'image')
  const attrs = linkAttrs(item)
  const stats = arr(item.stats).filter(isRecord)
  const badges = arr(item.badges).map((b) => (isRecord(b) ? { text: str(b.text ?? b.label), variant: b.variant } : { text: str(b), variant: undefined }))
  return (
    <article
      className={cn(
        'relative flex min-w-0 flex-1 flex-col gap-3 overflow-hidden rounded-xl border border-border bg-card p-4 text-card-foreground',
        attrs && 'transition-colors duration-100 hover:bg-muted/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring motion-reduce:transition-none',
      )}
    >
      {image && <img src={image} alt="" loading="lazy" decoding="async" className="-mx-4 -mt-4 aspect-video w-[calc(100%+2rem)] max-w-none bg-muted object-cover" />}
      <div className="flex min-w-0 items-center gap-3">
        {item.avatar != null && item.avatar !== false && <BlockAvatar src={safeUrl(item.avatar, 'image')} name={title} size="lg" />}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* The title link covers the card (after:inset-0); the ring goes round the card. */}
          <h3 className="truncate text-sm font-semibold text-foreground">
            {attrs ? <a {...attrs} className="outline-none after:absolute after:inset-0">{title}</a> : title}
          </h3>
          {subtitle && <p className={cn(META, 'truncate')}>{subtitle}</p>}
        </div>
      </div>
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {badges.map((b, i) => <Badge key={i} variant={badgeVariant(b.variant)}>{b.text}</Badge>)}
        </div>
      )}
      {description && <p className="line-clamp-2 text-sm text-muted-foreground">{description}</p>}
      {stats.length > 0 && (
        <dl className="mt-auto grid grid-cols-[repeat(auto-fit,minmax(min(100%,4.5rem),1fr))] gap-3 border-t border-border pt-3">
          {stats.map((s, i) => (
            <div key={i} className="flex min-w-0 flex-col">
              <dt className={cn(META, 'truncate')}>{str(s.label)}</dt>
              <dd className="m-0 truncate text-sm font-semibold tabular-nums text-foreground">{display(s.value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  )
}

/** `card_grid`: `columns` cards per row on a wide page, two at medium width, one on a phone. */
function CardGridBlock({ node }: Props) {
  const p = propsOf(node)
  const items = arr(p.items).filter(isRecord)
  const cols = Math.min(6, Math.max(1, Math.round(num(p.columns, 3))))
  if (items.length === 0) return null
  return (
    <div className="@container min-w-0">
      <ul
        style={{ '--aiui-cols': cols, '--aiui-cols-md': Math.min(2, cols) } as CSSProperties}
        className="m-0 grid min-w-0 list-none grid-cols-1 gap-4 p-0 @xl:grid-cols-[repeat(var(--aiui-cols-md),minmax(0,1fr))] @4xl:grid-cols-[repeat(var(--aiui-cols),minmax(0,1fr))]"
      >
        {items.map((item, i) => <li key={i} className="flex min-w-0"><EntityCard item={item} /></li>)}
      </ul>
    </div>
  )
}

/** Block type → renderer, merged into the core set by coreBlocks.tsx (which maps `link` itself). */
// eslint-disable-next-line react-refresh/only-export-components -- registry table
export function mediaBlocks(): Record<string, (props: Props) => JSX.Element | null> {
  return {
    avatar: AvatarBlock,
    audio_player: PlayerBlock,
    video_player: PlayerBlock,
    file_download: FileDownloadBlock,
    breadcrumb: BreadcrumbBlock,
    tooltip_wrap: TooltipBlock,
    popover: PopoverBlock,
    dialog: DialogBlock,
    card_grid: CardGridBlock,
  }
}
