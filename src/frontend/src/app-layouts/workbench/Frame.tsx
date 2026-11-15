/**
 * The Quiet Workbench frame (chunk `layout-workbench`; design Main.dc.html
 * and QuietPhone.dc.html in the Pro tokens).
 *
 *   desktop / tablet  a 256 px sidebar (brand and collapse ⌘B, New chat ⌘N,
 *                     the layout's primary pages, the rest folded under
 *                     More, "Chats" with search and times, the connection
 *                     line, Search ⌘K, theme) beside a 56 px top bar (title ·
 *                     agent · model, the `header:actions` slot, Share, More)
 *                     and the routed page
 *   phone             a header (menu, title with agent · model, new chat);
 *                     the menu opens the sidebar as a sheet
 *
 * The chat page draws itself quietly here (descriptor `chat`: sessions in
 * the frame, the `quiet` thread, approvals inline). Everything the frame
 * shows comes from LayoutProps and the layout feeds; a feed that is off
 * (the chat or approvals built-in disabled) hides its part.
 *
 * Isolation (R17): imports only the SDK, components/ui, lib, the kit and
 * this folder (app-layouts/isolation.test.ts).
 */
import { useCallback, useMemo, useState } from 'react'
import { Bot, Ellipsis, Menu, PanelLeft, Plus, Share, SquarePen, SunMoon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { LayoutProps } from '@/sdk/layouts'
import { notify } from '@/sdk/notify'
import { cn } from '@/lib/utils'
import {
  Brand,
  ConnectionStatus,
  NavList,
  NavSection,
  PhoneSheet,
  preloadPhoneSheet,
  SessionList,
  ShortcutHint,
  useApprovals,
  useChat,
  useSessions,
  useShortcut,
  type KitSize,
} from '@/app-layouts/kit'
import { agentOf, chatPageOf, frameTitle, readCollapsed, SHORTCUTS, waitingSessionIds, writeCollapsed } from './model'
import { useAgentModel } from './useAgentModel'

type SidebarProps = Pick<LayoutProps, 'nav' | 'chrome'> & {
  size: KitSize
  chatPage: string
  /** After a navigation or a chat is opened (the phone sheet closes). */
  onNavigate?(): void
}

function SidebarBody({ nav, chrome, size, chatPage, onNavigate }: SidebarProps) {
  const sessions = useSessions()
  const approvals = useApprovals()
  const pending = approvals?.state.pending
  const waiting = useMemo(() => waitingSessionIds(pending ?? []), [pending])
  const touch = size === 'touch'
  const more = nav.groups.flatMap((g) => g.items)
  const openChat = () => {
    if (nav.activeId !== chatPage) nav.go(chatPage)
    onNavigate?.()
  }

  return (
    <>
      {sessions && (
        <Button
          size="lg"
          data-aiui-new-chat=""
          className={cn('w-full justify-start shadow-sm', touch && 'h-11 text-[15px]')}
          onClick={() => {
            sessions.feed.create()
            openChat()
          }}
        >
          <Plus />
          <span className="flex-1 text-left">New chat</span>
          {!touch && <ShortcutHint combo={SHORTCUTS.newChat} tone="on-accent" />}
        </Button>
      )}
      <NavList items={nav.primary} go={nav.go} onNavigate={onNavigate} size={size} aria-label="Primary" />
      {more.length > 0 && (
        <NavSection title={`More (${more.length})`} folded size={size}>
          <div className="max-h-64 overflow-y-auto">
            <NavList items={more} go={nav.go} onNavigate={onNavigate} size={size} aria-label="More pages" />
          </div>
        </NavSection>
      )}
      <SessionList
        title="Chats"
        search
        showTime
        waitingIds={waiting}
        size={size}
        onOpen={openChat}
        className="min-h-0 flex-1"
      />
      <NavList items={nav.footer} go={nav.go} onNavigate={onNavigate} size={size} />
      <div className="mt-auto flex items-center gap-1 border-t border-sidebar-border pt-2 pl-2">
        <ConnectionStatus className={cn('flex-1', touch && 'text-sm')} />
        <Button
          variant="outline"
          size={touch ? 'default' : 'xs'}
          className={cn('text-muted-foreground', touch && 'h-11')}
          aria-label="Search pages and commands"
          onClick={() => {
            onNavigate?.()
            chrome.openPalette()
          }}
        >
          Search
          <ShortcutHint combo="mod+k" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(touch && 'size-11')}
          aria-label="Switch light or dark theme"
          onClick={chrome.toggleColorMode}
        >
          <SunMoon />
        </Button>
      </div>
      <chrome.Slot name="sidebar:footer" />
    </>
  )
}

/** "Researcher · gpt-4o-mini" for the open chat; nothing until an agent is known. */
function ChatMeta({ phone }: { phone: boolean }) {
  const chat = useChat()
  const sessions = useSessions()
  const agent = agentOf(chat?.state ?? null, sessions?.state ?? null)
  const model = useAgentModel(agent)
  if (!agent) return null
  if (phone) {
    return (
      <span data-aiui-chat-meta="" className="max-w-full truncate text-[13px] text-tier-3">
        {agent}
        {model && ` · ${model}`}
      </span>
    )
  }
  return (
    <span data-aiui-chat-meta="" className="flex min-w-0 shrink items-center gap-2">
      <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />
      <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
        <span className="sr-only">Agent: </span>
        <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-link">
          <Bot className="size-3" />
        </span>
        <span className="truncate">{agent}</span>
      </span>
      {model && (
        <span className="shrink-0 truncate font-mono text-xs text-tier-3">
          <span className="sr-only">Model: </span>
          {model}
        </span>
      )}
    </span>
  )
}

function ShareButton() {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return null
  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      void notify('Link copied', { type: 'success', id: 'aiui-workbench-share' })
    } catch {
      void notify('Could not copy the link', { type: 'error', id: 'aiui-workbench-share' })
    }
  }
  return (
    <Button variant="ghost" size="sm" aria-label="Share: copy a link to this page" onClick={() => void share()}>
      <Share />
      Share
    </Button>
  )
}

export default function WorkbenchFrame(props: LayoutProps) {
  const { Outlet, nav, chrome, viewport, page, pageId, fullBleed, layout } = props
  const phone = viewport === 'phone'
  const chatPage = chatPageOf(layout)
  const onChat = pageId === chatPage
  const sessions = useSessions()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [menuOpen, setMenuOpen] = useState(false)
  const title = frameTitle({ pageId, page, chatPage, sessions: sessions?.state ?? null, siteTitle: chrome.siteTitle })

  const newChat = useCallback(() => {
    sessions?.feed.create()
    if (nav.activeId !== chatPage) nav.go(chatPage)
  }, [sessions, nav, chatPage])
  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      writeCollapsed(!c)
      return !c
    })
  }, [])
  useShortcut(sessions ? SHORTCUTS.newChat : null, newChat, { allowInInputs: true })
  useShortcut(phone ? null : SHORTCUTS.toggleSidebar, toggleSidebar)
  const closeMenu = useCallback(() => setMenuOpen(false), [])

  const main = (
    <main
      id={chrome.mainId}
      tabIndex={-1}
      className={cn('min-h-0 min-w-0 flex-1 outline-none', fullBleed ? 'flex flex-col overflow-hidden' : 'overflow-y-auto')}
    >
      <Outlet />
    </main>
  )

  if (phone) {
    return (
      <div data-aiui-layout-frame="workbench" data-viewport={viewport} className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-11 text-foreground"
            aria-label="Open menu"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onPointerEnter={preloadPhoneSheet}
            onFocus={preloadPhoneSheet}
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="size-5" />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col items-center px-1 leading-tight">
            <h1 className="m-0 max-w-full truncate text-[15px] font-semibold tracking-tight">{title}</h1>
            {onChat && <ChatMeta phone />}
          </div>
          {sessions ? (
            <Button variant="ghost" size="icon" className="size-11 text-foreground" aria-label="New chat" onClick={newChat}>
              <SquarePen className="size-5" />
            </Button>
          ) : (
            <span aria-hidden="true" className="size-11 shrink-0" />
          )}
        </header>
        {main}
        <PhoneSheet open={menuOpen} onOpenChange={setMenuOpen} title="Menu" header={<Brand chrome={chrome} size="touch" />}>
          <SidebarBody nav={nav} chrome={chrome} size="touch" chatPage={chatPage} onNavigate={closeMenu} />
        </PhoneSheet>
      </div>
    )
  }

  return (
    <div data-aiui-layout-frame="workbench" data-viewport={viewport} className="flex min-h-0 min-w-0 flex-1">
      {!collapsed && (
        <nav
          aria-label="Main"
          data-aiui-workbench-sidebar=""
          className="flex w-64 shrink-0 flex-col gap-4 overflow-hidden border-r border-sidebar-border bg-sidebar p-3 text-sidebar-foreground"
        >
          <div className="flex h-8 shrink-0 items-center justify-between gap-2 pl-1">
            <Brand chrome={chrome} />
            <Button variant="ghost" size="icon-sm" aria-label="Collapse sidebar" title="Collapse sidebar" aria-expanded onClick={toggleSidebar}>
              <PanelLeft />
            </Button>
          </div>
          <SidebarBody nav={nav} chrome={chrome} size="default" chatPage={chatPage} />
        </nav>
      )}
      <div className="flex min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border pr-4 pl-6">
          {collapsed && (
            <Button variant="ghost" size="icon-sm" className="-ml-2" aria-label="Expand sidebar" title="Expand sidebar" aria-expanded={false} onClick={toggleSidebar}>
              <PanelLeft />
            </Button>
          )}
          <h1 className="m-0 min-w-0 shrink truncate text-[15px] font-semibold tracking-tight">{title}</h1>
          {onChat && <ChatMeta phone={false} />}
          <span className="flex-1" />
          <chrome.Slot name="header:actions" className="flex items-center gap-1" />
          <ShareButton />
          <Button variant="ghost" size="icon-sm" aria-label="More: search pages and commands" onClick={() => chrome.openPalette()}>
            <Ellipsis />
          </Button>
        </header>
        {main}
      </div>
    </div>
  )
}
