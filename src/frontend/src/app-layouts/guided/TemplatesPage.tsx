/**
 * Guided Studio's Templates page (`templates`): every template by category,
 * a search box and category filters. A template opens a new chat with its
 * prompt in the composer, ready to change and send. A shell-only page owned
 * by builtin.layout-guided; a lazy chunk of this layout.
 */
import { use, useMemo, useState, type JSX } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import type { ShellPage } from '@/sdk/manifest'
import { cn } from '@/lib/utils'
import { useStartFromTemplate } from './chat'
import { TemplateCard } from './parts'
import { filterTemplates, groupByCategory, loadTemplates } from './templates'

export default function TemplatesPage({ page }: { page: ShellPage }): JSX.Element {
  const all = use(loadTemplates())
  const start = useStartFromTemplate()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | undefined>(undefined)
  const categories = useMemo(() => groupByCategory(all).map((g) => g.name), [all])
  const shown = useMemo(() => groupByCategory(filterTemplates(all, query, category)), [all, query, category])
  const chip = (value: string | undefined, label: string) => (
    <button
      key={label}
      type="button"
      aria-pressed={category === value}
      onClick={() => setCategory(value)}
      className={cn(
        'min-h-11 rounded-full border px-4 text-[15px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
        category === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-muted',
      )}
    >
      {label}
    </button>
  )

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 text-base sm:px-7" data-guided-page={page.id}>
      <p className="m-0 max-w-[40rem] text-[17px] text-muted-foreground">
        Pick a template to start a new chat with it filled in. You can change the words before you send.
      </p>
      <div className="flex flex-col gap-3">
        <div className="relative max-w-md">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-tier-3" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates"
            aria-label="Search templates"
            className="h-12 rounded-2xl pl-11 text-base"
          />
        </div>
        {categories.length > 1 && (
          <div role="group" aria-label="Show templates for" className="flex flex-wrap gap-2">
            {chip(undefined, 'All')}
            {categories.map((c) => chip(c, c))}
          </div>
        )}
      </div>
      {shown.length === 0 ? (
        <p role="status" className="m-0 rounded-2xl bg-muted p-5 text-muted-foreground">
          No templates match. Try other words, or start a new chat and ask in your own words.
        </p>
      ) : (
        shown.map((g, i) => (
          <section key={g.name} aria-labelledby={`aiui-tpl-${i}`} className="flex flex-col gap-3">
            <h2 id={`aiui-tpl-${i}`} className="m-0 text-lg font-extrabold">{g.name}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((t) => (
                <TemplateCard key={t.id} t={t} onUse={start} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
