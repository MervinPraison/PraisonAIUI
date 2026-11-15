/**
 * The Guided Studio frame (chunk `layout-guided`; Guided.dc.html and
 * GuidedPhone.dc.html on the PraisonAI Pro tokens). For newcomers: a few
 * large, labelled destinations and plain words everywhere.
 *
 *   desktop  a 280 px sidebar: brand, "Start a new chat", Home / Chat /
 *            My agents / Templates / Help, "Your recent chats" as cards (5),
 *            the other pages folded under "More tools", Settings; a header
 *            "Chatting with X · ready to help" with Search ⌘K and Change agent
 *   phone    a 60 px header (your chats, the chat's title, new chat), the
 *            page, and four bottom tabs: Home, Chat, My agents, Help
 *
 * The chat itself (step tracker, explained approval card, follow-up chips,
 * templates on an empty chat) is the chat page's, styled by this layout's
 * meta.chat (builtin/layouts/guided.ts). A layout imports only the SDK,
 * components/ui, lib and the kit, never another layout or the shell
 * (app-layouts/isolation.test.ts).
 */
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Bot, Menu, Plus, Search, Sparkles, SunMoon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { LayoutNavItem, LayoutProps } from '@/sdk/layouts'
import { cn } from '@/lib/utils'
import { isPlainLeftClick, NavList, NavSection, PhoneSheet, PhoneTabs, preloadPhoneSheet, ShortcutHint, useSessions, useShortcut } from '@/app-layouts/kit'
import { guidedNav, HELP_ID, helpAddress, PAGE, type GuidedItem } from './nav'
import { agentOf, useChat } from './chat'
import { PAGE_ICONS } from './icons'
import { ChatCard } from './parts'

const RECENT = 5

/** A page's icon (`fallback` text, else its first letters, for a page Guided has no icon for). */
function PageIcon({ id, className, fallback }: { id: string; className?: string; fallback?: string }) {
  const Icon = PAGE_ICONS[id]
  if (Icon) return <Icon aria-hidden className={className} />
  return (
    <span aria-hidden="true" className={cn('inline-flex shrink-0 items-center justify-center', className)}>
      {(fallback ?? id).slice(0, 2)}
    </span>
  )
}

function Brand({ chrome, size = 'lg' }: Pick<LayoutProps, 'chrome'> & { size?: 'lg' | 'sm' }) {
  const logo = chrome.siteLogo
  const tile = size === 'lg' ? 'size-10 rounded-xl' : 'size-8 rounded-lg'
  return (
    <span className="flex min-w-0 items-center gap-3 px-2 text-foreground">
      {logo?.kind === 'img' ? (
        <img src={logo.value} alt="" className={cn(tile, 'shrink-0 object-cover')} />
      ) : (
        <span aria-hidden="true" className={cn(tile, 'flex shrink-0 items-center justify-center bg-primary text-primary-foreground')}>
          {logo?.value ? <span className="text-base font-extrabold">{logo.value}</span> : <Sparkles className="size-6" />}
        </span>
      )}
      <span className={cn('truncate font-extrabold tracking-tight', size === 'lg' ? 'text-xl' : 'text-lg')}>{chrome.siteTitle}</span>
    </span>
  )
}

/** A Guided destination row: 50 px, a 22 px icon, 17 px label (Pro: 44 px or more on every viewport). */
function DestRow({ item, onGo }: { item: GuidedItem; onGo(item: GuidedItem): void }) {
  return (
    <li>
      <a
        href={item.href}
        aria-current={item.active ? 'page' : undefined}
        data-aiui-nav-item={item.id}
        {...(item.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        onClick={(e) => {
          if (item.external || !isPlainLeftClick(e)) return
          e.preventDefault()
          onGo(item)
        }}
        className={cn(
          'flex min-h-12 items-center gap-3 rounded-xl px-3.5 text-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
          item.active ? 'bg-accent-soft font-bold text-link' : 'font-semibold text-sidebar-foreground hover:bg-sidebar-accent/70',
        )}
      >
        <PageIcon id={item.id} fallback={item.icon ?? item.title.slice(0, 1)} className="size-6 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{item.title}</span>
        {item.badge ? <span className="text-sm text-muted-foreground tabular-nums" aria-label={`${item.badge} new`}>{item.badge}</span> : null}
      </a>
    </li>
  )
}

/** "Your recent chats": the newest five as cards, with "See all" when the server has a sessions page. */
function RecentChats({ limit, seeAll, onOpen }: { limit?: number; seeAll?: () => void; onOpen(id: string): void }) {
  const sessions = useSessions()
  if (!sessions) return null
  const { feed, state } = sessions
  const shown = limit ? state.sessions.slice(0, limit) : state.sessions
  return (
    <section aria-labelledby="aiui-guided-recent" className="flex flex-col gap-2.5" data-aiui-session-list="">
      <div className="flex items-baseline justify-between px-1.5">
        <h2 id="aiui-guided-recent" className="m-0 text-[15px] font-bold text-muted-foreground">Your recent chats</h2>
        {seeAll && state.sessions.length > (limit ?? Infinity) && (
          <button type="button" onClick={seeAll} className="min-h-8 rounded-md px-1 text-sm font-semibold text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            See all
          </button>
        )}
      </div>
      {state.loading && state.sessions.length === 0 ? (
        <p role="status" className="m-0 px-1.5 text-sm text-muted-foreground">Loading your chats…</p>
      ) : shown.length === 0 ? (
        <p className="m-0 px-1.5 text-sm text-muted-foreground">No chats yet. Start one above.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {shown.map((s) => (
            <li key={s.id}>
              <ChatCard
                s={s}
                active={s.id === state.activeId}
                running={state.runningIds.has(s.id)}
                onOpen={(id) => {
                  feed.select(id)
                  onOpen(id)
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function MoreTools({ more, go, onNavigate, size }: { more: ReturnType<typeof guidedNav>['more']; go(id: string): void; onNavigate?(): void; size: 'default' | 'touch' }) {
  if (more.length === 0) return null
  return (
    <NavSection title="More tools" folded size={size}>
      <div className="flex flex-col gap-2 pt-1">
        {more.map((g) => (
          <div key={g.name} className="flex flex-col gap-0.5">
            {more.length > 1 && <span className="px-2 text-xs font-medium text-muted-foreground">{g.name}</span>}
            <NavList items={g.items} go={go} onNavigate={onNavigate} size={size} />
          </div>
        ))}
      </div>
    </NavSection>
  )
}

function SettingsRow({ item, go, toggleColorMode }: { item: LayoutNavItem | null; go(id: string): void; toggleColorMode(): void }) {
  return (
    <div className="mt-auto flex items-center gap-1">
      {item && (
        <a
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          data-aiui-nav-item={item.id}
          onClick={(e) => {
            if (!isPlainLeftClick(e)) return
            e.preventDefault()
            go(item.id)
          }}
          className={cn(
            'flex min-h-12 flex-1 items-center gap-3 rounded-xl px-3.5 text-[15px] font-semibold outline-none hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-ring',
            item.active ? 'bg-accent-soft text-link' : 'text-sidebar-foreground',
          )}
        >
          <PageIcon id={PAGE.settings} className="size-5 shrink-0" />
          {item.title}
        </a>
      )}
      <Button variant="ghost" size="icon" className="ml-auto size-11 shrink-0 rounded-xl" aria-label="Switch light or dark theme" onClick={toggleColorMode}>
        <SunMoon className="size-5" />
      </Button>
    </div>
  )
}

export default function GuidedFrame(props: LayoutProps) {
  const { Outlet, nav, chrome, viewport, page, pageId, fullBleed, layout } = props
  const phone = viewport === 'phone'
  const [sheetOpen, setSheetOpen] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const spec = layout.available.find((s) => s.id === layout.id)
  const helpUrl = helpAddress(spec?.options?.helpUrl)
  const g = useMemo(() => guidedNav(nav, { helpUrl }), [nav, helpUrl])
  const sessions = useSessions()
  const { state: chat } = useChat()
  const has = (id: string) => g.byId.has(id)
  const chatPage = has(PAGE.chat) ? PAGE.chat : spec?.home
  const onChat = pageId === PAGE.chat
  const session = sessions?.state.sessions.find((s) => s.id === sessions.state.activeId)
  const agent = agentOf(chat, session)

  const newChat = () => {
    sessions?.feed.create()
    if (chatPage) nav.go(chatPage)
    setSheetOpen(false)
  }
  useShortcut(sessions ? 'mod+n' : null, newChat, { allowInInputs: true })

  const go = (item: GuidedItem) => {
    setSheetOpen(false)
    if (item.external) {
      window.open(item.external, '_blank', 'noopener,noreferrer')
      return
    }
    if (item.id === HELP_ID) {
      chrome.openPalette()
      return
    }
    nav.go(item.id)
  }
  const goId = (id: string) => {
    setSheetOpen(false)
    nav.go(id)
  }
  const openChat = () => {
    setSheetOpen(false)
    if (chatPage) nav.go(chatPage)
  }
  /** The chat page's own agent picker, else the agents page, else the palette. */
  const changeAgent = () => {
    const picker = mainRef.current?.querySelector<HTMLSelectElement>('[data-aiui-chat] select[aria-label="Agent"]')
    if (picker) {
      picker.focus()
      try {
        picker.showPicker?.()
      } catch {
        /* not allowed here: focus is enough */
      }
      return
    }
    if (has(PAGE.agents)) nav.go(PAGE.agents)
    else chrome.openPalette({ query: 'agent' })
  }

  const pageTitle = (page && g.byId.get(page.id)?.title) ?? page?.title ?? chrome.siteTitle
  const title = onChat ? (session?.title ?? 'New chat') : pageTitle
  const who = agent ?? 'your assistant'
  const waiting = chat.messages.at(-1)?.status?.type === 'requires-action'
  const doing = waiting ? 'waiting for your OK' : chat.isRunning ? 'working on it' : 'ready to help'
  const subtitle: ReactNode = onChat ? (
    <>
      <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', waiting || chat.isRunning ? 'bg-warning' : 'bg-success')} />
      {phone ? `with ${who}` : `Chatting with ${who} · ${doing}`}
    </>
  ) : (
    page?.description
  )
  const headIcon = (cls: string) =>
    onChat ? <Bot className={cls} /> : page && PAGE_ICONS[page.id] ? <PageIcon id={page.id} className={cls} /> : <Sparkles className={cls} />

  const main = (
    <main
      ref={mainRef}
      id={chrome.mainId}
      tabIndex={-1}
      className={cn(
        'min-h-0 min-w-0 flex-1 outline-none',
        fullBleed ? 'flex flex-col overflow-hidden' : 'overflow-y-auto',
        // The frame's header names the chat; the page keeps its agent picker and connection badge.
        '[&_[data-chat-title]]:sr-only',
      )}
    >
      <Outlet />
    </main>
  )

  if (phone) {
    return (
      <div data-aiui-layout-frame="guided" data-viewport={viewport} className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-base">
        <header className="flex h-15 shrink-0 items-center gap-1.5 border-b border-border bg-background px-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 rounded-xl"
            aria-label="Your chats and more"
            aria-haspopup="dialog"
            onPointerEnter={preloadPhoneSheet}
            onFocus={preloadPhoneSheet}
            onClick={() => setSheetOpen(true)}
          >
            <Menu className="size-6" />
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-link">
              {headIcon('size-4')}
            </span>
            <div className="min-w-0 leading-snug">
              <h1 className="m-0 truncate text-base font-extrabold">{title}</h1>
              {subtitle && <p className="m-0 flex items-center gap-1.5 truncate text-[13px] text-muted-foreground">{subtitle}</p>}
            </div>
          </div>
          {sessions && (
            <Button size="icon" className="size-11 shrink-0 rounded-xl" aria-label="Start a new chat" onClick={newChat}>
              <Plus className="size-6" strokeWidth={2.25} />
            </Button>
          )}
        </header>
        {main}
        <PhoneTabs
          tabs={g.tabs.map((t) => ({
            id: t.id,
            label: t.title,
            href: t.href,
            icon: PAGE_ICONS[t.id],
            active: t.active,
            badge: t.badge,
            onSelect: () => go(t),
          }))}
        />
        <PhoneSheet open={sheetOpen} onOpenChange={setSheetOpen} title="Your chats and more" header={<Brand chrome={chrome} size="sm" />}>
          <div className="flex min-h-0 flex-col gap-5">
            {sessions && (
              <Button className="h-12 w-full rounded-2xl text-base font-bold" onClick={newChat}>
                <Plus className="size-5" />
                Start a new chat
              </Button>
            )}
            <RecentChats onOpen={openChat} />
            <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Pages">
              {g.main.filter((i) => !g.tabs.some((t) => t.id === i.id)).map((i) => (
                <DestRow key={i.id} item={i} onGo={go} />
              ))}
            </ul>
            <MoreTools more={g.more} go={goId} size="touch" />
            <SettingsRow item={g.settings} go={goId} toggleColorMode={chrome.toggleColorMode} />
            <chrome.Slot name="sidebar:footer" />
          </div>
        </PhoneSheet>
      </div>
    )
  }

  return (
    <div data-aiui-layout-frame="guided" data-viewport={viewport} className="flex min-h-0 min-w-0 flex-1 bg-background text-base">
      <nav aria-label="Main" className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto *:shrink-0 border-r border-sidebar-border bg-sidebar px-4 py-4 text-sidebar-foreground">
        <Brand chrome={chrome} />
        {sessions && (
          <Button className="h-12 w-full rounded-2xl text-lg font-bold shadow-sm" onClick={newChat} aria-keyshortcuts="Meta+N Control+N">
            <Plus className="size-6" strokeWidth={2.25} />
            Start a new chat
          </Button>
        )}
        <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label="Primary">
          {g.main.map((i) => (
            <DestRow key={i.id} item={i} onGo={go} />
          ))}
        </ul>
        <RecentChats limit={RECENT} seeAll={has(PAGE.sessions) ? () => nav.go(PAGE.sessions) : undefined} onOpen={openChat} />
        <MoreTools more={g.more} go={goId} size="default" />
        <SettingsRow item={g.settings} go={goId} toggleColorMode={chrome.toggleColorMode} />
        <chrome.Slot name="sidebar:footer" />
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-background px-6 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-link">
              {headIcon('size-6')}
            </span>
            <div className="min-w-0">
              <h1 className="m-0 truncate text-xl leading-snug font-extrabold">{title}</h1>
              {subtitle && <p className="m-0 flex items-center gap-1.5 truncate text-sm text-muted-foreground">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <chrome.Slot name="header:actions" className="flex items-center gap-1" />
            <Button variant="outline" className="h-11 rounded-xl px-3.5 text-[15px] font-semibold" onClick={() => chrome.openPalette()} aria-keyshortcuts="Meta+K Control+K">
              <Search className="size-4" />
              Search
              <ShortcutHint combo="mod+k" className="ml-1" />
            </Button>
            {onChat && (
              <Button variant="outline" className="h-11 rounded-xl px-3.5 text-[15px] font-semibold" onClick={changeAgent}>
                <Bot className="size-4" />
                Change agent
              </Button>
            )}
          </div>
        </header>
        {main}
      </div>
    </div>
  )
}
