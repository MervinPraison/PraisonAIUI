import { Menu, Monitor, Moon, Search, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { isMacPlatform, openCommandPalette, paletteShortcutLabel, preloadCommandPalette } from './palette'
import { Kbd } from '@/components/ui/kbd'

const MODES = ['system', 'light', 'dark'] as const
type Mode = (typeof MODES)[number]
const MODE_LABEL: Record<Mode, string> = { system: 'System', light: 'Light', dark: 'Dark' }

function asMode(v: string | undefined): Mode {
  return v === 'light' || v === 'dark' ? v : 'system'
}

/** One button that cycles System → Light → Dark. The palette offers all three directly. */
export function ModeToggle() {
  const { theme, setTheme } = useTheme()
  const mode = asMode(theme)
  const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length]
  const Icon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(next)}
      aria-label={`Theme: ${MODE_LABEL[mode]}. Switch to ${MODE_LABEL[next]}`}
      data-aiui-mode={mode}
      className="text-muted-foreground hover:text-foreground"
    >
      <Icon />
    </Button>
  )
}

function SearchButton() {
  const shortcut = paletteShortcutLabel()
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={openCommandPalette}
        onPointerEnter={preloadCommandPalette}
        onFocus={preloadCommandPalette}
        aria-label="Search pages and commands"
        aria-keyshortcuts={isMacPlatform() ? 'Meta+K' : 'Control+K'}
        className="hidden w-56 justify-start gap-2 font-normal text-muted-foreground md:inline-flex"
      >
        <Search />
        <span className="flex-1 text-left">Search…</span>
        <Kbd>{shortcut}</Kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={openCommandPalette}
        aria-label="Search pages and commands"
        className="text-muted-foreground hover:text-foreground md:hidden"
      >
        <Search />
      </Button>
    </>
  )
}

export function ShellHeader({
  title,
  description,
  showMenuButton,
  onOpenMenu,
  onPreloadMenu,
}: {
  title: string
  description?: string
  showMenuButton: boolean
  onOpenMenu: () => void
  onPreloadMenu: () => void
}) {
  return (
    <header
      data-aiui-shell-header=""
      className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3 md:px-4"
    >
      {showMenuButton && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenMenu}
          onPointerEnter={onPreloadMenu}
          onFocus={onPreloadMenu}
          aria-label="Open navigation"
          className="-ml-1 text-muted-foreground hover:text-foreground md:hidden"
        >
          <Menu />
        </Button>
      )}
      <div className="flex min-w-0 flex-1 items-baseline gap-3">
        <h1 className="truncate text-sm font-semibold text-foreground">{title}</h1>
        {description && (
          <p className="hidden min-w-0 truncate text-xs text-muted-foreground lg:block">{description}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <SearchButton />
        <ModeToggle />
      </div>
    </header>
  )
}

/** With the header hidden (layout.pageHeader=false) phones still need a way to open the nav. */
export function FloatingMenuButton({ onOpenMenu, onPreloadMenu }: { onOpenMenu: () => void; onPreloadMenu: () => void }) {
  return (
    <Button
      variant="outline"
      size="icon-sm"
      onClick={onOpenMenu}
      onPointerEnter={onPreloadMenu}
      onFocus={onPreloadMenu}
      aria-label="Open navigation"
      className="fixed top-2 left-2 z-[var(--z-sticky,20)] bg-background shadow-sm md:hidden"
    >
      <Menu />
    </Button>
  )
}
