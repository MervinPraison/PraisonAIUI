/**
 * The canvas tab strip: one tab per artifact (its latest version), arrow
 * keys move between them (WAI-ARIA tabs, automatic activation). The one in
 * the split pane is marked "split".
 */
import { useRef, type JSX, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { DerivedArtifact } from './derive'
import { PANEL_ID as panelId, tabId } from './format'
import { KindIcon } from './viewers/Viewer'

export function Tabs({ items, selected, split, onSelect, children }: {
  items: readonly DerivedArtifact[]
  selected: string | null
  split: string | null
  onSelect(key: string): void
  /** Buttons on the right of the strip. */
  children?: ReactNode
}): JSX.Element {
  const list = useRef<HTMLDivElement>(null)
  const onKeyDown = (e: KeyboardEvent) => {
    const i = items.findIndex((a) => a.key === selected)
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null
    if (next === null || !items.length) return
    e.preventDefault()
    const a = items[(next + items.length) % items.length]
    onSelect(a.key)
    list.current?.querySelector<HTMLElement>(`#${CSS.escape(tabId(a.key))}`)?.focus()
  }
  return (
    <div className="flex items-end gap-0.5 border-b border-hairline bg-sidebar px-2 pt-2">
      <div ref={list} role="tablist" aria-label="Canvas artifacts" className="flex min-w-0 items-end gap-0.5 overflow-x-auto" onKeyDown={onKeyDown}>
        {items.map((a) => {
          const active = a.key === selected
          const file = a.kind === 'code' && a.key === a.title
          return (
            <button
              key={a.key}
              type="button"
              role="tab"
              id={tabId(a.key)}
              aria-selected={active}
              aria-controls={active ? panelId : undefined}
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(a.key)}
              title={a.title}
              className={cn(
                '-mb-px flex h-9 max-w-56 shrink-0 items-center gap-1.5 rounded-t-lg border px-3 text-sm whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'border-hairline border-b-card bg-card font-semibold text-foreground' : 'border-transparent text-tier-2 hover:text-foreground',
                file && 'font-mono text-xs',
              )}
            >
              <KindIcon kind={a.kind} className={cn('size-3.5 shrink-0', active && 'text-link')} />
              <span className="truncate">{a.title}</span>
              {a.key === split && <span className="font-sans text-2xs font-normal text-tier-3">split</span>}
            </button>
          )
        })}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5 pb-1">{children}</div>
    </div>
  )
}
