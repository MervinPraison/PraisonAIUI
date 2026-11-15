/**
 * The Mission Control layout frame (chunk `layout-mission`; Mission.dc.html
 * and MissionPhone.dc.html with the PraisonAI Pro tokens): an operations
 * view where what waits on the viewer comes first.
 *
 *   desktop  top bar (site title, `options.environment` badge, search, health,
 *            approvals bell), nav with counts, the approval banner on every
 *            page, and on the chat page the ops column (KPI strip, agents,
 *            the agent's sessions) beside the chat with its header
 *   home     the ops overview (the `ops-overview` page, or Mission's home
 *            while no catalog page replaces it)
 *   phone    header (brand, search, bell), the approval card, the page, and
 *            bottom tabs (the first four primary pages, then More)
 *
 * The ops column, the overview and the run feed are the mission board
 * (layout-features/mission-board, chunk lf-mission-board), loaded with
 * import() only when this frame shows them. A layout imports only the SDK,
 * components/ui, lib and the kit (app-layouts/isolation.test.ts).
 */
import { Component, lazy, Suspense, useRef, useState, type ReactNode } from 'react'
import { Bell, Menu, Search, SunMoon } from 'lucide-react'
import { NavList, NavSection, PhoneSheet, PhoneTabs, SessionList, useSessions, useShortcut, type PhoneTab } from '@/app-layouts/kit'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { LayoutProps } from '@/sdk/layouts'
import { useApprovals, useChatState, useHealth, useRunCounts, useRunsFeed } from './data'
import {
  APPROVALS_PAGE,
  CHAT_PAGE,
  DEFAULT_HOME,
  environmentOf,
  frameContent,
  hasPage,
  missionSpec,
  phoneNav,
  RUNS_PAGE,
  SHORTCUTS,
  type NavCounts,
} from './model'
import { iconFor } from './icons'
import './mission.css'
import { BrandMark, ChatHeader, CountBadge, EnvBadge, HealthDot, MorePagesButton, NavRows, TopBar } from './parts'

// The board is one chunk (layout-features/mission-board/index.ts): every part comes from that one import().
const board = () => import('@/layout-features/mission-board')
const OpsColumn = lazy(() => board().then((m) => ({ default: m.OpsColumn })))
const OpsOverview = lazy(() => board().then((m) => ({ default: m.OpsOverview })))
const AttentionBanner = lazy(() => board().then((m) => ({ default: m.AttentionBanner })))

/** A board part that fails to load or render disappears on its own (logged); the frame keeps working (R4). */
class PartBoundary extends Component<{ name: string; fallback?: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.warn(`[aiui mission] the ${this.props.name} failed to load or render`, error)
  }
  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children
  }
}

function OpsSkeleton() {
  return (
    <div role="status" aria-label="Loading the overview" className="flex flex-col gap-3 p-4">
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <Skeleton className="h-20 w-full rounded-lg" />
    </div>
  )
}

export default function MissionFrame(props: LayoutProps) {
  const { Outlet, nav, chrome, viewport, page, pageId, fullBleed } = props
  const phone = viewport === 'phone'
  const spec = missionSpec(props.layout.available, props.layout.id)
  const home = spec?.home ?? DEFAULT_HOME
  const env = environmentOf(spec)
  const content = frameContent(pageId, page, home)

  const approvals = useApprovals()
  const runs = useRunsFeed()
  const counts: NavCounts = { ...useRunCounts(runs), approvals: approvals.pending.length }
  const health = useHealth()
  const sessions = useSessions()
  const chat = useChatState()
  const approveRef = useRef<HTMLButtonElement>(null)
  const [moreOpen, setMoreOpen] = useState(false)

  const canReview = hasPage(nav, APPROVALS_PAGE)
  const review = canReview ? () => nav.go(APPROVALS_PAGE) : undefined
  const openChat = () => nav.go(CHAT_PAGE)
  useShortcut(sessions ? SHORTCUTS.newChat : null, () => {
    sessions?.feed.create()
    openChat()
  }, { allowInInputs: true })
  useShortcut(SHORTCUTS.approval, () => approveRef.current?.focus(), { allowInInputs: true })

  // The banner decides itself whether anything waits (an approval, or a gate in the open chat).
  const bannerEl = (cls?: string) => (
    <PartBoundary name="approval banner">
      <Suspense fallback={null}>
        <AttentionBanner
          pageId={page?.id ?? pageId}
          approvalsPage={APPROVALS_PAGE}
          chatPage={CHAT_PAGE}
          touch={phone}
          go={nav.go}
          canReview={canReview}
          approveRef={approveRef}
          className={cls}
        />
      </Suspense>
    </PartBoundary>
  )

  const overview = (
    <PartBoundary name="ops overview" fallback={<Outlet />}>
      <Suspense fallback={<OpsSkeleton />}>
        <OpsOverview viewport={viewport} openChat={openChat} environment={env} />
      </Suspense>
    </PartBoundary>
  )

  const main = (children: ReactNode, cls?: string) => (
    <main
      id={chrome.mainId}
      tabIndex={-1}
      className={cn('min-h-0 min-w-0 flex-1 outline-none', fullBleed || content === 'chat' ? 'flex flex-col overflow-hidden' : 'overflow-y-auto', cls)}
    >
      {children}
    </main>
  )

  if (phone) {
    const pn = phoneNav(nav)
    const tabs: PhoneTab[] = pn.tabs.map((item) => ({
      id: item.id,
      label: item.title,
      href: item.href,
      icon: iconFor(item),
      active: item.active,
      badge: item.id === APPROVALS_PAGE ? counts.approvals : undefined,
      onSelect: () => nav.go(item.id),
    }))
    tabs.push({ id: 'more', label: 'More', icon: Menu, active: moreOpen, onSelect: () => setMoreOpen(true) })
    return (
      <div data-aiui-layout-frame="mission" data-viewport={viewport} className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-card pr-1.5 pl-2">
          <a
            href={`/${home}`}
            onClick={(e) => {
              e.preventDefault()
              nav.go(home)
            }}
            className="flex h-11 min-w-0 items-center gap-2 rounded-lg px-2 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BrandMark chrome={chrome} className="size-7 rounded-[7px]" />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[15px] font-semibold">{page?.title && content !== 'ops' ? page.title : chrome.siteTitle}</span>
              <span className="flex items-center gap-1 truncate font-mono text-xs text-tier-3">
                <HealthDot state={health.state} />
                {[env, health.label].filter(Boolean).join(' · ')}
              </span>
            </span>
          </a>
          <Button variant="ghost" size="icon" className="ml-auto size-11" aria-label="Search" onClick={() => chrome.openPalette()}>
            <Search aria-hidden className="size-5" />
          </Button>
          {canReview && (
            <Button
              variant="ghost"
              size="icon"
              className="relative size-11"
              aria-label={counts.approvals ? `Approvals, ${counts.approvals} waiting` : 'Approvals, none waiting'}
              data-aiui-approvals-bell={counts.approvals}
              onClick={review}
            >
              <Bell aria-hidden className="size-5" />
              {counts.approvals > 0 && <CountBadge n={counts.approvals} className="absolute top-1.5 right-1.5 text-[11px] leading-[14px]" />}
            </Button>
          )}
        </header>
        {content !== 'ops' && bannerEl('mx-4 mt-3')}
        {main(content === 'ops' ? overview : <Outlet />)}
        <PhoneTabs tabs={tabs} label="Primary" />
        <PhoneSheet
          open={moreOpen}
          onOpenChange={setMoreOpen}
          title="More pages and chats"
          header={
            <span className="flex min-w-0 items-center gap-2">
              <BrandMark chrome={chrome} className="size-6" />
              <span className="truncate text-[15px] font-semibold">{chrome.siteTitle}</span>
              {env && <EnvBadge env={env} />}
            </span>
          }
        >
          <NavRows items={pn.more} go={nav.go} counts={counts} onNavigate={() => setMoreOpen(false)} touch />
          {pn.groups.map((g) => (
            <NavSection key={g.name} title={g.name} folded size="touch">
              <NavList items={g.items} go={nav.go} onNavigate={() => setMoreOpen(false)} size="touch" />
            </NavSection>
          ))}
          <SessionList size="touch" limit={12} onOpen={() => {
            setMoreOpen(false)
            openChat()
          }} />
          <div className="mt-auto flex items-center gap-1 border-t border-border pt-2">
            <Button variant="ghost" className="h-11 flex-1 justify-start" onClick={() => {
              setMoreOpen(false)
              chrome.openPalette()
            }}>
              <Search aria-hidden />
              Search and more
            </Button>
            <Button variant="ghost" size="icon" className="size-11" aria-label="Switch light or dark theme" onClick={chrome.toggleColorMode}>
              <SunMoon aria-hidden />
            </Button>
          </div>
        </PhoneSheet>
      </div>
    )
  }

  // ── desktop and tablet ──
  const desktop = viewport === 'desktop'
  const activeSession = sessions?.state.sessions.find((s) => s.id === sessions.state.activeId)
  const lastTurn = [...chat.state.messages].reverse().find((m) => m.role === 'assistant')
  const chatState = lastTurn?.status?.type === 'requires-action' ? 'waiting' : chat.state.isRunning ? 'running' : 'idle'
  const runId = chat.state.activeRunId ?? lastTurn?.runId
  const chatMeta = [lastTurn?.agentName, runId && `run ${runId.slice(0, 8)}`, lastTurn ? `started ${clock(lastTurn.createdAt)}` : undefined]
    .filter(Boolean)
    .join(' · ')

  return (
    <div data-aiui-layout-frame="mission" data-viewport={viewport} className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <TopBar
        chrome={chrome}
        env={env}
        health={health}
        pending={counts.approvals}
        onBell={review}
        goHome={() => nav.go(home)}
        homeHref={`/${home}`}
      />
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Main" className="flex w-[216px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-background px-2 py-3">
          <NavRows items={nav.primary} go={nav.go} counts={counts} />
          {nav.groups.map((g) => (
            <NavSection key={g.name} title={g.name} folded>
              <NavList items={g.items} go={nav.go} />
            </NavSection>
          ))}
          <NavRows items={nav.footer} go={nav.go} counts={counts} />
          <div className="mt-auto flex flex-col gap-2 border-t border-border p-2.5">
            <MorePagesButton chrome={chrome} />
            {/* The top bar's pill is the one status indicator. */}
            {!!health.agents && <span className="font-mono text-xs text-tier-3">{health.agents} agents configured</span>}
            <chrome.Slot name="sidebar:footer" />
          </div>
        </nav>

        {content === 'chat' ? (
          <div className="flex min-h-0 min-w-0 flex-1">
            {desktop && (
              <PartBoundary name="ops column">
                <Suspense fallback={<div className="w-[clamp(300px,28vw,400px)] shrink-0 border-r border-border bg-background"><OpsSkeleton /></div>}>
                  <OpsColumn openChat={openChat} className="w-[clamp(300px,28vw,400px)] shrink-0" />
                </Suspense>
              </PartBoundary>
            )}
            <section aria-label="Chat" className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
              <ChatHeader
                title={activeSession?.title ?? 'New chat'}
                state={chatState}
                meta={chatMeta}
                onStop={chat.state.isRunning && chat.cancel ? () => void chat.cancel!() : undefined}
                onOpenRuns={hasPage(nav, RUNS_PAGE) ? () => nav.go(RUNS_PAGE) : undefined}
              />
              {bannerEl('mx-5 mt-3')}
              {main(<Outlet />)}
            </section>
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {content === 'ops' ? (
              // The overview lists every pending approval itself.
              main(overview)
            ) : (
              <>
                <div className="flex h-12 shrink-0 items-center border-b border-hairline px-6">
                  <h1 className="m-0 min-w-0 truncate text-[15px] font-semibold tracking-tight">{page?.title ?? pageId}</h1>
                </div>
                {bannerEl('mx-4 mt-3')}
                {main(<Outlet />)}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function clock(at: number): string {
  const d = new Date(at)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}
