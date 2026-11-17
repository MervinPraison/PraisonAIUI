/**
 * The Chat and Canvas sidebar (Canvas.dc.html): brand and collapse, New chat
 * (⌘N), the primary pages (the artifacts count on Artifacts), the groups
 * plugins declared, the chats with their artifact counts, and at the foot
 * Settings (the config page), Plugin settings (when a plugin has some),
 * More (⌘K, the command palette with every other page, the footer pages
 * such as Inspector among them), the theme switch (phone) and
 * the connection line ("Connected · local"). The same body fills the phone menu sheet
 * with 44 px rows.
 */
import { CircleEllipsis, PanelLeftClose, SquarePen, SunMoon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandTile, ConnectionStatus, DeclaredNavGroups, isPlainLeftClick, PluginSettingsRow, ShortcutHint, useSessions, type KitSize } from '@/app-layouts/kit'
import type { LayoutChrome, LayoutNav, LayoutNavItem } from '@/sdk/layouts'
import { cn } from '@/lib/utils'
import { ChatList } from './ChatList'
import type { ArtifactIndex } from './data'
import { ARTIFACTS_PAGE, sidebarRows } from './frameLogic'
import { NavIcon } from './icons'

/** This page is served from this machine ("Connected · local"). */
const isLocalHost = () => typeof location !== 'undefined' && /^(localhost|127(\.\d+){3}|\[::1\])$/.test(location.hostname)

export function Brand({ chrome, size = 'default' }: { chrome: Pick<LayoutChrome, 'siteTitle' | 'siteLogo'>; size?: KitSize }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5 text-foreground">
      <BrandTile chrome={chrome} className="size-[26px] rounded-[7px] text-sm" />
      <span className={cn('truncate font-display font-semibold tracking-tight', size === 'touch' ? 'text-xl' : 'text-lg')}>{chrome.siteTitle}</span>
    </span>
  )
}

function NavRows({
  items,
  go,
  size,
  onNavigate,
  badge,
  label,
}: {
  items: readonly LayoutNavItem[]
  go(id: string): void
  size: KitSize
  onNavigate?(): void
  badge?(item: LayoutNavItem): number | undefined
  label?: string
}) {
  if (items.length === 0) return null
  return (
    <ul className="m-0 flex list-none flex-col gap-px p-0" aria-label={label}>
      {items.map((item) => {
        const count = badge?.(item) ?? item.badge
        return (
          <li key={item.id}>
            <a
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              data-aiui-nav-item={item.id}
              className={cn(
                'flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-sidebar-foreground no-underline outline-none transition-colors',
                'hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-ring',
                size === 'touch' ? 'h-11 text-[15px]' : 'h-8 text-sm',
                item.active && 'bg-sidebar-accent font-semibold text-foreground',
              )}
              onClick={(e) => {
                if (!isPlainLeftClick(e)) return
                e.preventDefault()
                go(item.id)
                onNavigate?.()
              }}
            >
              <NavIcon item={item} />
              <span className="min-w-0 flex-1 truncate">{item.title}</span>
              {count ? (
                <span className="ml-auto text-[13px] font-normal text-muted-foreground tabular-nums" aria-label={`${count} in all`}>
                  {count}
                </span>
              ) : null}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

export interface SidebarBodyProps {
  nav: LayoutNav
  chrome: LayoutChrome
  size: KitSize
  /** The page New chat and a chat row open (the layout's home). */
  chatPage?: string
  /** Artifacts across chats (the Artifacts row) and per chat (the chat rows), when known. */
  artifacts?: ArtifactIndex
  /** Desktop only: hide the sidebar (⌘B). */
  onCollapse?(): void
  /** After any navigation (the phone sheet closes). */
  onNavigate?(): void
}

export function SidebarBody({ nav, chrome, size, chatPage, artifacts, onCollapse, onNavigate }: SidebarBodyProps) {
  const sessions = useSessions()
  const touch = size === 'touch'
  const openChat = () => {
    if (chatPage && nav.activeId !== chatPage) nav.go(chatPage)
    onNavigate?.()
  }
  const badge = (item: LayoutNavItem) => (item.id === ARTIFACTS_PAGE ? artifacts?.total : undefined)
  const rows = sidebarRows(nav)
  return (
    <>
      {onCollapse && (
        <div className="flex items-center gap-2 px-1 py-0.5">
          <Brand chrome={chrome} size={size} />
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto text-muted-foreground"
            aria-label="Collapse sidebar"
            aria-keyshortcuts="Meta+B Control+B"
            title="Collapse sidebar (⌘B)"
            onClick={onCollapse}
          >
            <PanelLeftClose />
          </Button>
        </div>
      )}
      {sessions && (
        <Button
          variant="outline"
          className={cn('w-full justify-start bg-card font-semibold text-foreground shadow-xs', touch ? 'h-11 text-[15px]' : 'h-9')}
          aria-keyshortcuts="Meta+N Control+N"
          onClick={() => {
            sessions.feed.create()
            openChat()
          }}
          data-cc-new-chat=""
        >
          <SquarePen />
          <span className="flex-1 text-left">New chat</span>
          {!touch && <ShortcutHint combo="mod+n" />}
        </Button>
      )}
      <NavRows items={rows.primary} go={nav.go} size={size} onNavigate={onNavigate} badge={badge} label="Primary" />
      <DeclaredNavGroups nav={nav} size={size} onNavigate={() => onNavigate?.()} />
      <ChatList size={size} onOpen={openChat} counts={artifacts?.bySession} className="min-h-0 flex-1" />
      <div className="mt-auto flex flex-col gap-px pt-1">
        {rows.settings && <NavRows items={[rows.settings]} go={nav.go} size={size} onNavigate={onNavigate} />}
        <PluginSettingsRow chrome={chrome} size={size} onNavigate={onNavigate} className="px-2.5" />
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sidebar-foreground outline-none transition-colors',
            'hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-ring',
            touch ? 'h-11 text-[15px]' : 'h-8 text-sm',
          )}
          onClick={() => {
            onNavigate?.()
            chrome.openPalette()
          }}
          data-cc-more=""
        >
          {/* The command palette (⌘K, also the header's search): every page not listed above. */}
          <CircleEllipsis aria-hidden="true" className="size-4 shrink-0" />
          <span className="flex-1">More</span>
          {!touch && <ShortcutHint combo="mod+k" />}
        </button>
        {touch && (
          <button
            type="button"
            className="flex h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[15px] text-sidebar-foreground outline-none hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-ring"
            onClick={chrome.toggleColorMode}
          >
            <SunMoon aria-hidden="true" className="size-4 shrink-0" />
            Switch light or dark theme
          </button>
        )}
        <ConnectionStatus className="px-2.5 pt-2 pb-0.5" detail={isLocalHost() ? 'local' : undefined} />
        <chrome.Slot name="sidebar:footer" />
      </div>
    </>
  )
}
