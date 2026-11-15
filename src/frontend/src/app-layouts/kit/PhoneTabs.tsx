/**
 * A phone bottom tab bar (Guided, Mission). Pro spec: 68 px bar, equal
 * columns, a 24 px icon over a 13 px label, the current tab on the accent
 * pill; every tab is at least 44 px tall.
 */
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'
import { isPlainLeftClick } from './rows'

export interface PhoneTab {
  id: string
  label: string
  href?: string
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  active?: boolean
  /** Count on the tab (0 hides it). */
  badge?: number
  onSelect(): void
}

export function PhoneTabs({ tabs, label = 'Main' }: { tabs: readonly PhoneTab[]; label?: string }) {
  return (
    <nav
      aria-label={label}
      data-aiui-phone-tabs=""
      className="grid h-[68px] shrink-0 border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)]"
      style={{ gridTemplateColumns: `repeat(${Math.max(tabs.length, 1)}, minmax(0, 1fr))` }}
    >
      {tabs.map((t) => {
        const Icon = t.icon
        return (
          <a
            key={t.id}
            href={t.href ?? '#'}
            aria-current={t.active ? 'page' : undefined}
            data-aiui-tab={t.id}
            onClick={(e) => {
              if (!isPlainLeftClick(e)) return
              e.preventDefault()
              t.onSelect()
            }}
            className={cn(
              'flex min-h-11 flex-col items-center justify-center gap-0.5 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
              t.active ? 'text-link' : 'text-muted-foreground',
            )}
          >
            <span
              className={cn('relative flex h-[30px] w-14 items-center justify-center rounded-full', t.active && 'bg-accent-soft')}
            >
              {Icon ? <Icon aria-hidden className="size-6" /> : <span aria-hidden="true">{t.label.slice(0, 1)}</span>}
              {t.badge ? (
                <span
                  className="absolute -top-1 right-1 min-w-4 rounded-full bg-destructive px-1 text-[11px] leading-4 text-destructive-foreground tabular-nums"
                  aria-label={`${t.badge} pending`}
                >
                  {t.badge}
                </span>
              ) : null}
            </span>
            <span className="truncate">{t.label}</span>
          </a>
        )
      })}
    </nav>
  )
}
