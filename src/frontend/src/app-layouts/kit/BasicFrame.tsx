/**
 * A plain frame built from the kit: a 256 px sidebar (brand, New chat,
 * primary nav, the other pages under "More", recent chats, search and
 * theme), a 56 px top bar and the routed page. On a phone the sidebar moves
 * into a PhoneSheet behind a menu button. The stub frames of the built-in
 * layouts use it until their own frames land; a plugin layout may too.
 */
import { useState, type ReactNode } from 'react'
import { Menu, Plus, Search, SunMoon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { LayoutProps } from '@/sdk/layouts'
import { cn } from '@/lib/utils'
import { Brand } from './Brand'
import { NavList, NavSection } from './NavList'
import { PhoneSheet } from './PhoneSheet'
import { preloadPhoneSheet } from './phoneSheetLoader'
import type { KitSize } from './rows'
import { SessionList } from './SessionList'
import { ShortcutHint } from './ShortcutHint'
import { useSessions } from './useSessions'
import { useShortcut } from './useShortcut'

export interface BasicFrameProps extends LayoutProps {
  /** The layout id (data-aiui-layout-frame), for styles and tests. */
  name: string
  /** Page the session list and New chat open. Default: the layout's home, else none. */
  chatPage?: string
  /** Extra content at the top of the main column (a status strip). */
  banner?: ReactNode
}

function SidebarBody({
  nav,
  chrome,
  size,
  chatPage,
  onNavigate,
}: Pick<LayoutProps, 'nav' | 'chrome'> & { size: KitSize; chatPage?: string; onNavigate?: () => void }) {
  const sessions = useSessions()
  const openChat = () => {
    if (chatPage) nav.go(chatPage)
    onNavigate?.()
  }
  return (
    <>
      {sessions && (
        <Button
          variant="outline"
          className={cn('w-full justify-start bg-card', size === 'touch' && 'h-11')}
          onClick={() => {
            sessions.feed.create()
            openChat()
          }}
        >
          <Plus />
          <span className="flex-1 text-left">New chat</span>
        </Button>
      )}
      <NavList items={nav.primary} go={nav.go} onNavigate={onNavigate} size={size} aria-label="Primary" />
      {nav.groups.map((g) => (
        <NavSection key={g.name} title={g.name} folded={nav.primary.length > 0 ? true : g.folded} size={size}>
          <NavList items={g.items} go={nav.go} onNavigate={onNavigate} size={size} />
        </NavSection>
      ))}
      <SessionList size={size} limit={20} onOpen={openChat} className="min-h-0 flex-1" />
      <NavList items={nav.footer} go={nav.go} onNavigate={onNavigate} size={size} />
      <div className="mt-auto flex items-center gap-1 border-t border-sidebar-border pt-2">
        <Button
          variant="ghost"
          className={cn('flex-1 justify-start text-muted-foreground', size === 'touch' && 'h-11')}
          aria-label="Search and more"
          onClick={() => chrome.openPalette()}
        >
          <Search />
          <span className="flex-1 text-left">Search and more</span>
          <ShortcutHint combo="mod+k" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(size === 'touch' && 'size-11')}
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

export function BasicFrame({ name, chatPage, banner, ...props }: BasicFrameProps) {
  const { Outlet, nav, chrome, viewport, page, fullBleed } = props
  const phone = viewport === 'phone'
  const [menuOpen, setMenuOpen] = useState(false)
  const target = chatPage ?? props.layout.available.find((s) => s.id === props.layout.id)?.home
  const sessions = useSessions()
  useShortcut(sessions ? 'mod+n' : null, () => {
    sessions?.feed.create()
    if (target) nav.go(target)
  }, { allowInInputs: true })

  return (
    <div data-aiui-layout-frame={name} data-viewport={viewport} className="flex min-h-0 min-w-0 flex-1">
      {!phone && (
        <nav
          aria-label="Main"
          className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-sidebar-border bg-sidebar p-3 text-sidebar-foreground"
        >
          <div className="flex h-8 items-center pl-1">
            <Brand chrome={chrome} />
          </div>
          <SidebarBody nav={nav} chrome={chrome} size="default" chatPage={target} />
        </nav>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className={cn('flex shrink-0 items-center gap-2 border-b border-border', phone ? 'h-14 px-1.5' : 'h-14 pr-4 pl-6')}>
          {phone && (
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label="Open menu and chats"
              aria-haspopup="dialog"
              onPointerEnter={preloadPhoneSheet}
              onFocus={preloadPhoneSheet}
              onClick={() => setMenuOpen(true)}
            >
              <Menu />
            </Button>
          )}
          <h1 className="m-0 min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">{page?.title ?? chrome.siteTitle}</h1>
          <chrome.Slot name="header:actions" className="flex items-center gap-1" />
        </header>
        {banner}
        <main
          id={chrome.mainId}
          tabIndex={-1}
          className={cn('min-h-0 min-w-0 flex-1 outline-none', fullBleed ? 'flex flex-col overflow-hidden' : 'overflow-y-auto')}
        >
          <Outlet />
        </main>
      </div>
      {phone && (
        <PhoneSheet open={menuOpen} onOpenChange={setMenuOpen} title="Menu and chats" header={<Brand chrome={chrome} />}>
          <SidebarBody nav={nav} chrome={chrome} size="touch" chatPage={target} onNavigate={() => setMenuOpen(false)} />
        </PhoneSheet>
      )}
    </div>
  )
}
