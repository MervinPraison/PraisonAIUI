/**
 * The Chat and Canvas top bars. Desktop (Canvas.dc.html): the title over
 * "Researcher · 3 artifacts · edited 2 min ago", Search or run a command
 * (⌘K), the chat's Canvas toggle (portalled into `[data-aiui-aside-slot]`),
 * Share (copies the link; the chat page only) and the theme switch, then
 * the shell's `header:actions` slot. Phone (CanvasPhone.dc.html): menu, the centred
 * title and line, New chat; 44 px targets.
 */
import type { ReactNode } from 'react'
import { Menu, Moon, PanelLeftOpen, Search, Share, SquarePen, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { preloadPhoneSheet, ShortcutHint } from '@/app-layouts/kit'
import type { LayoutChrome } from '@/sdk/layouts'
import { useThemeMode } from '@/sdk/services'
import { cn } from '@/lib/utils'
import { copyLink } from './share'

export interface TitleLine {
  title: string
  /** The second line (on the chat page, a ChatLine: it renders its own paragraph, or nothing). */
  subtitle?: ReactNode
}

function ThemeButton({ chrome, className }: { chrome: Pick<LayoutChrome, 'toggleColorMode'>; className?: string }) {
  const dark = useThemeMode() === 'dark'
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('text-muted-foreground', className)}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={chrome.toggleColorMode}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  )
}

export function TopBar({
  line,
  chrome,
  collapsed,
  onExpand,
  share = true,
  onChatPage = false,
}: {
  line: TitleLine
  chrome: LayoutChrome
  /** Share the link: on the chat page only (a dashboard page has nothing to share; pages add their own actions in header:actions). */
  share?: boolean
  /** The chat page: its Canvas toggle joins the bar. */
  onChatPage?: boolean
  /** The sidebar is hidden: show the button that brings it back. */
  collapsed: boolean
  onExpand(): void
}) {
  return (
    <header className="flex min-h-[60px] shrink-0 flex-wrap items-center gap-2.5 border-b border-border py-2 pr-4 pl-6 data-[collapsed]:pl-3" data-collapsed={collapsed || undefined}>
      {collapsed && (
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground"
          aria-label="Show sidebar"
          aria-keyshortcuts="Meta+B Control+B"
          title="Show sidebar (⌘B)"
          onClick={onExpand}
        >
          <PanelLeftOpen />
        </Button>
      )}
      <div className="min-w-0 flex-[1_1_260px]">
        <h1 className="m-0 truncate font-display text-xl leading-tight font-medium tracking-tight" data-cc-title="">
          {line.title}
        </h1>
        {line.subtitle}
      </div>
      <Button
        variant="outline"
        className="h-[34px] min-w-[200px] justify-start bg-card font-normal text-muted-foreground max-lg:min-w-0"
        aria-label="Search or run a command"
        aria-keyshortcuts="Meta+K Control+K"
        onClick={() => chrome.openPalette()}
      >
        <Search />
        <span className="flex-1 text-left max-lg:sr-only">Search or run a command</span>
        <ShortcutHint combo="mod+k" className="max-lg:hidden" />
      </Button>
      {/* The chat's Canvas toggle (pressed while open, with the count) is portalled here from the chat page. */}
      {onChatPage && <span className="contents" data-aiui-aside-slot="" />}
      {share && (
        <Button variant="outline" className="h-[34px] text-foreground" onClick={() => void copyLink()} data-cc-share="">
          <Share />
          Share
        </Button>
      )}
      <ThemeButton chrome={chrome} className="size-[34px]" />
      <chrome.Slot name="header:actions" className="flex items-center gap-1" />
    </header>
  )
}

export function PhoneTopBar({
  line,
  chrome,
  canCreate,
  onMenu,
  onNewChat,
}: {
  line: TitleLine
  chrome: LayoutChrome
  /** The sessions feed is on (New chat has something to do). */
  canCreate: boolean
  onMenu(): void
  onNewChat(): void
}) {
  return (
    <header className="flex shrink-0 items-center gap-1 px-1.5 pt-1.5 pb-1">
      <Button
        variant="ghost"
        size="icon"
        className="size-11 rounded-xl text-foreground"
        aria-label="Open menu and chats"
        aria-haspopup="dialog"
        onPointerEnter={preloadPhoneSheet}
        onFocus={preloadPhoneSheet}
        onClick={onMenu}
      >
        <Menu className="size-5" />
      </Button>
      <div className="min-w-0 flex-1 text-center">
        <h1 className="m-0 truncate font-display text-lg leading-tight font-medium tracking-tight" data-cc-title="">
          {line.title}
        </h1>
        {line.subtitle}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <chrome.Slot name="header:actions" className="flex items-center gap-0.5" />
        {canCreate && (
          <Button variant="ghost" size="icon" className="size-11 rounded-xl text-foreground" aria-label="New chat" onClick={onNewChat}>
            <SquarePen className="size-5" />
          </Button>
        )}
      </div>
    </header>
  )
}
