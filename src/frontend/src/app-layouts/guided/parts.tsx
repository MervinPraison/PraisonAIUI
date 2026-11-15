/**
 * Components the Guided frame, its pages and its chat regions share: chat
 * cards and template cards. Guided look (Guided.dc.html on the
 * Pro tokens): large type, 14-18 px radii, 44 px or larger targets, plain
 * words.
 */
import { ChartColumn, Code, Lightbulb, ListChecks, PenLine, Sparkles } from 'lucide-react'
import type { SessionSummary } from '@/sdk/layoutTypes'
import { cn } from '@/lib/utils'
import { whenLabel } from './nav'
import type { GuidedTemplate } from './templates'

const CATEGORY_ICONS = {
  write: PenLine,
  learn: Lightbulb,
  plan: ListChecks,
  code: Code,
  analyse: ChartColumn,
  analyze: ChartColumn,
} as const

function CategoryIcon({ category }: { category: string }) {
  const Icon = CATEGORY_ICONS[category.toLowerCase() as keyof typeof CATEGORY_ICONS] ?? Sparkles
  return <Icon className="size-5" />
}

/** One template: its mark, title and what it is for. The whole card is the button. */
export function TemplateCard({ t, onUse, compact }: { t: GuidedTemplate; onUse(t: GuidedTemplate): void; compact?: boolean }) {
  return (
    <button
      type="button"
      data-guided-template={t.id}
      onClick={() => onUse(t)}
      className={cn(
        'flex min-h-14 w-full min-w-0 items-start gap-3 rounded-2xl border border-border bg-card text-left text-card-foreground shadow-sm outline-none transition-colors',
        'hover:border-primary/40 hover:bg-accent-soft/40 focus-visible:ring-2 focus-visible:ring-ring',
        compact ? 'p-3' : 'p-4',
      )}
    >
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-lg text-link">
        {t.icon ?? <CategoryIcon category={t.category} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base font-bold leading-snug break-words">{t.title}</span>
        {t.description && <span className="text-sm text-muted-foreground break-words">{t.description}</span>}
      </span>
    </button>
  )
}

/** A recent chat as a card: its title, then "Today, 2:14 pm · with Researcher". */
export function ChatCard({ s, active, running, onOpen }: { s: SessionSummary; active: boolean; running?: boolean; onOpen(id: string): void }) {
  const meta = [whenLabel(s.updatedAt), s.agent ? `with ${s.agent}` : ''].filter(Boolean).join(' · ')
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      data-aiui-session={s.id}
      onClick={() => onOpen(s.id)}
      className={cn(
        'flex w-full min-w-0 flex-col gap-0.5 rounded-[14px] border px-3.5 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'border-primary/30 bg-card shadow-sm' : 'border-transparent hover:bg-sidebar-accent/70',
      )}
    >
      <span className={cn('line-clamp-2 text-base leading-[1.35] text-foreground break-words', active ? 'font-bold' : 'font-semibold')}>{s.title}</span>
      {(meta || running) && (
        <span className="flex items-center gap-1.5 text-sm text-tier-3">
          {running && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning" />}
          {running ? 'Working on it' : meta}
        </span>
      )}
    </button>
  )
}
