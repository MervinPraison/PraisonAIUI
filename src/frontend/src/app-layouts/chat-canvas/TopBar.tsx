/**
 * The Chat and Canvas top bars. Desktop (Canvas.dc.html): the title over
 * "Researcher · 3 artifacts · edited 2 min ago", Search or run a command
 * (⌘K), Share (copies the link) and the theme switch, then the shell's
 * `header:actions` slot. Phone (CanvasPhone.dc.html): menu, the centred
 * title and line, New chat; 44 px targets.
 */
import { Menu, Moon, PanelLeftOpen, Search, Share, SquarePen, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { preloadPhoneSheet, ShortcutHint } from '@/app-layouts/kit'
import type { LayoutChrome } from '@/sdk/layouts'
import { useThemeMode } from '@/sdk/services'
import { cn } from '@/lib/utils'
import { copyLink } from './share'

export interface TitleLine {
  title: string
  subtitle?: string
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
}: {
  line: TitleLine
  chrome: LayoutChrome
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
        <h1 className="m-0 truncate text-xl leading-tight font-semibold tracking-tight" data-cc-title="">
          {line.title}
        </h1>
        {line.subtitle && (
          <p className="m-0 truncate text-[13px] text-muted-foreground" data-cc-subtitle="">
            {line.subtitle}
          </p>
        )}
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
      <Button variant="outline" className="h-[34px] text-foreground" onClick={() => void copyLink()} data-cc-share="">
        <Share />
        Share
      </Button>
      <ThemeButton chrome={chrome} className="size-[34px]" />
      <chrome.Slot name="header:actions" className="flex items-center gap-1" />
    </header>
  )
}

export function PhoneTopBar({
  line,
  canCreate,
  onMenu,
  onNewChat,
}: {
  line: TitleLine
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
        aria-label="Open navigation and chats"
        aria-haspopup="dialog"
        onPointerEnter={preloadPhoneSheet}
        onFocus={preloadPhoneSheet}
        onClick={onMenu}
      >
        <Menu className="size-5" />
      </Button>
      <div className="min-w-0 flex-1 text-center">
        <h1 className="m-0 truncate text-lg leading-tight font-semibold tracking-tight" data-cc-title="">
          {line.title}
        </h1>
        {line.subtitle && (
          <p className="m-0 truncate text-[13px] text-muted-foreground" data-cc-subtitle="">
            {line.subtitle}
          </p>
        )}
      </div>
      {canCreate ? (
        <Button variant="ghost" size="icon" className="size-11 rounded-xl text-foreground" aria-label="New chat" onClick={onNewChat}>
          <SquarePen className="size-5" />
        </Button>
      ) : (
        <span className="size-11 shrink-0" aria-hidden="true" />
      )}
    </header>
  )
}
