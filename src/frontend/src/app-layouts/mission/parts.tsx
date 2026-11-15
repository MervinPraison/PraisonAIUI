/**
 * Mission Control frame pieces (Mission.dc.html, MissionPhone.dc.html, Pro
 * tokens): the brand, the top bar, the nav with counts and the chat
 * header (the approval banner is the mission board's, loaded lazily). Tokens and primitives only.
 */
import { Bell, CircleStop, Search, SunMoon, TriangleAlert } from 'lucide-react'
import { BrandTile, isPlainLeftClick, ShortcutHint } from '@/app-layouts/kit'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { LayoutChrome, LayoutNavItem } from '@/sdk/layouts'
import { renderNavIcon } from './icons'
import { navCount, type HealthState, type NavCounts } from './model'

export function NavIcon({ item, className }: { item: LayoutNavItem; className?: string }) {
  const icon = renderNavIcon(item, cn('shrink-0', className))
  if (icon) return icon
  // Never the page's emoji (it renders differently on every OS): its initial.
  const mark = item.title.slice(0, 1).toUpperCase()
  return (
    <span aria-hidden="true" className={cn('flex shrink-0 items-center justify-center text-xs', className)}>
      {mark}
    </span>
  )
}

export function BrandMark({ chrome, className }: { chrome: LayoutChrome; className?: string }) {
  return <BrandTile chrome={chrome} className={cn('rounded-md text-xs', className)} />
}

export function EnvBadge({ env }: { env: string }) {
  return <span className="rounded-xs bg-muted px-1.5 py-px font-mono text-xs font-medium text-muted-foreground">{env}</span>
}

const HEALTH_DOT: Record<HealthState, string> = { ok: 'bg-success', degraded: 'bg-warning', unknown: 'bg-muted-foreground' }

export function HealthDot({ state }: { state: HealthState }) {
  return <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', HEALTH_DOT[state])} />
}

// ── top bar (desktop) ────────────────────────────────────────────────

export interface TopBarProps {
  chrome: LayoutChrome
  env?: string
  health: { state: HealthState; label: string }
  pending: number
  /** Opens the approvals page (absent: the bell is not shown). */
  onBell?(): void
  goHome(): void
  homeHref: string
}

export function TopBar({ chrome, env, health, pending, onBell, goHome, homeHref }: TopBarProps) {
  return (
    <header data-aiui-mission-topbar="" className="flex min-h-[52px] shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4">
      <a
        href={homeHref}
        onClick={(e) => {
          if (!isPlainLeftClick(e)) return
          e.preventDefault()
          goHome()
        }}
        className="flex min-w-0 items-center gap-2 rounded-md text-[15px] font-semibold tracking-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BrandMark chrome={chrome} className="size-6" />
        <span className="truncate">{chrome.siteTitle}</span>
      </a>
      {env && (
        <>
          <span aria-hidden="true" className="h-5 w-px bg-border" />
          <EnvBadge env={env} />
        </>
      )}
      <div className="flex min-w-0 flex-[1_1_240px] justify-center">
        <button
          type="button"
          aria-label="Search agents, runs, sessions and pages"
          onClick={() => chrome.openPalette()}
          className="flex h-[34px] w-full max-w-[460px] min-w-0 items-center gap-2 rounded-md border border-border bg-background pr-1.5 pl-2.5 text-sm text-tier-3 outline-none hover:border-input focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search aria-hidden className="size-4" />
          <span className="min-w-0 flex-1 truncate text-left">Search agents, runs, sessions…</span>
          <ShortcutHint combo="mod+k" />
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          data-aiui-health={health.state}
          className="hidden h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-[13px] text-muted-foreground lg:flex"
        >
          <HealthDot state={health.state} />
          {health.label}
        </span>
        {onBell && (
          <Button
            variant="ghost"
            size="icon-lg"
            className="relative"
            aria-label={pending ? `Approvals, ${pending} waiting` : 'Approvals, none waiting'}
            data-aiui-approvals-bell={pending}
            onClick={onBell}
          >
            <Bell aria-hidden className="size-[18px]" />
            {pending > 0 && <CountBadge n={pending} className="absolute top-0.5 right-0" />}
          </Button>
        )}
        <Button variant="ghost" size="icon-lg" aria-label="Switch light or dark theme" onClick={chrome.toggleColorMode}>
          <SunMoon aria-hidden />
        </Button>
        <chrome.Slot name="header:actions" className="flex items-center gap-1" />
      </div>
    </header>
  )
}

export function CountBadge({ n, className }: { n: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'min-w-4 rounded-xs border-2 border-card bg-warning px-1 text-center text-[10px] leading-3 font-semibold text-warning-foreground tabular-nums',
        className,
      )}
    >
      {n > 99 ? '99+' : n}
    </span>
  )
}

// ── side nav (desktop) ───────────────────────────────────────────────

export function NavRows({ items, go, counts, onNavigate, touch }: { items: readonly LayoutNavItem[]; go(id: string): void; counts: NavCounts; onNavigate?(): void; touch?: boolean }) {
  if (items.length === 0) return null
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {items.map((item) => {
        const count = navCount(item, counts)
        return (
          <li key={item.id}>
            <a
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              aria-label={count ? `${item.title}, ${count.label}` : undefined}
              data-aiui-nav-item={item.id}
              onClick={(e) => {
                if (!isPlainLeftClick(e)) return
                e.preventDefault()
                go(item.id)
                onNavigate?.()
              }}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 font-medium outline-none transition-colors',
                'hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring',
                touch ? 'h-11 text-[15px]' : 'h-[34px] text-sm',
                item.active ? 'bg-accent-soft font-semibold text-link' : 'text-muted-foreground',
              )}
            >
              <NavIcon item={item} className="size-4" />
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              {count &&
                (count.warn ? (
                  <span aria-hidden="true" className="flex h-[18px] items-center gap-[3px] rounded-xs border border-[var(--ui-warning-line)] bg-warning-soft text-warning px-1.5 text-xs font-semibold tabular-nums">
                    <TriangleAlert className="size-2.5" />
                    {count.value}
                  </span>
                ) : (
                  <span aria-hidden="true" className="font-mono text-xs text-tier-3 tabular-nums">
                    {count.value}
                  </span>
                ))}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

// ── chat header ──────────────────────────────────────────────────────

export interface ChatHeaderProps {
  title: string
  state: 'running' | 'waiting' | 'idle'
  meta: string
  onStop?(): void
  onOpenRuns?(): void
}

export function ChatHeader({ title, state, meta, onStop, onOpenRuns }: ChatHeaderProps) {
  return (
    <div data-aiui-mission-chat-header="" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-hairline px-5 py-2.5">
      <div className="flex min-w-0 flex-col gap-px">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="m-0 truncate text-base font-semibold tracking-tight">{title}</h1>
          {state === 'running' && (
            <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-xs bg-success px-1.5 text-xs font-semibold text-success-foreground">
              <span aria-hidden="true" className="size-2 rounded-full bg-current" />
              Running
            </span>
          )}
          {state === 'waiting' && (
            <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-xs border border-[var(--ui-warning-line)] bg-warning-soft text-warning px-1.5 text-xs font-medium">
              <TriangleAlert aria-hidden className="size-3" />
              Waiting for approval
            </span>
          )}
        </div>
        {meta && <span className="truncate font-mono text-xs text-tier-3">{meta}</span>}
      </div>
      <div className="ml-auto flex items-center gap-1.5">
        {onOpenRuns && (
          <Button variant="link" size="sm" onClick={onOpenRuns}>
            Open runs
          </Button>
        )}
        {onStop && (
          <Button variant="outline" size="sm" onClick={onStop}>
            <CircleStop aria-hidden />
            Stop run
          </Button>
        )}
      </div>
    </div>
  )
}

export function MorePagesButton({ chrome }: { chrome: LayoutChrome }) {
  return (
    <button
      type="button"
      onClick={() => chrome.openPalette()}
      className="flex h-[30px] items-center gap-2 rounded-md px-0.5 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      More pages
      <ShortcutHint combo="mod+k" />
    </button>
  )
}
