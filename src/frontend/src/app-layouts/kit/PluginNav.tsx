/**
 * What a frame shows of the plugins' own navigation, whatever else it lists
 * (ADR 0003, R2: a plugin's nav group and settings reach every layout, not
 * only the classic frame):
 *
 *   - DeclaredNavGroups: the groups a plugin declared (registerNavGroup, a
 *     plugin's nav_groups()), in the shell's group order and folded as
 *     declared. Built-in groups stay in More / ⌘K, as each frame's design says.
 *   - PluginSettingsRow: opens the plugin settings dialog; drawn only while
 *     some plugin contributes a settings section (LayoutChrome.openSettings).
 */
import { SlidersHorizontal } from 'lucide-react'
import type { LayoutChrome, LayoutNav } from '@/sdk/layouts'
import { cn } from '@/lib/utils'
import { NavList, NavSection } from './NavList'
import { declaredGroups, navRowClass, type KitSize } from './rows'

export function DeclaredNavGroups({
  nav,
  size = 'default',
  onNavigate,
  className,
}: {
  nav: Pick<LayoutNav, 'groups' | 'go'>
  size?: KitSize
  onNavigate?(pageId: string): void
  className?: string
}) {
  const groups = declaredGroups(nav)
  if (groups.length === 0) return null
  return (
    <div className={cn('flex shrink-0 flex-col', className)} data-aiui-declared-groups="">
      {groups.map((g) => (
        <NavSection key={g.name} title={g.name} folded={g.folded && !g.items.some((i) => i.active)} size={size} className="mt-2">
          <NavList items={g.items} go={nav.go} onNavigate={onNavigate} size={size} />
        </NavSection>
      ))}
    </div>
  )
}

export function PluginSettingsRow({
  chrome,
  size = 'default',
  onNavigate,
  className,
}: {
  chrome: Pick<LayoutChrome, 'openSettings'>
  size?: KitSize
  /** Before the dialog opens (a phone sheet closes itself). */
  onNavigate?(): void
  className?: string
}) {
  const open = chrome.openSettings
  if (!open) return null
  return (
    <button
      type="button"
      className={cn(navRowClass(size), className)}
      aria-haspopup="dialog"
      data-aiui-settings-button=""
      onClick={() => {
        onNavigate?.()
        open()
      }}
    >
      <SlidersHorizontal aria-hidden="true" className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">Plugin settings</span>
    </button>
  )
}
