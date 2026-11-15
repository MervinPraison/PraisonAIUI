/**
 * An empty chat in Guided Studio (the `empty` region): "Pick a template to
 * get started" and four templates, then "See all templates" when the server
 * lists the templates page. A template puts its prompt in this chat's
 * composer. A lazy chunk of this layout, loaded only for an empty chat.
 */
import { use, type JSX } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ChatRegionProps } from '@/sdk/layouts'
import { navigate, useManifest } from '@/sdk/services'
import { cn } from '@/lib/utils'
import { PAGE } from './nav'
import { useStartFromTemplate } from './chat'
import { TemplateCard } from './parts'
import { loadTemplates } from './templates'

const SHOWN = 4

export default function TemplatesEmpty({ viewport }: ChatRegionProps): JSX.Element {
  const all = use(loadTemplates())
  const start = useStartFromTemplate(true)
  const manifest = useManifest()
  const hasPage = !!manifest?.pages.some((p) => p.id === PAGE.templates)
  const phone = viewport === 'phone'
  return (
    <section aria-labelledby="aiui-guided-pick" className="flex w-full flex-col gap-3 text-left" data-guided-templates>
      <h3 id="aiui-guided-pick" className="m-0 text-base font-bold text-muted-foreground">Pick a template to get started</h3>
      <div className={cn('grid gap-2.5', !phone && 'sm:grid-cols-2')}>
        {all.slice(0, SHOWN).map((t) => (
          <TemplateCard key={t.id} t={t} onUse={start} compact={phone} />
        ))}
      </div>
      {hasPage && all.length > SHOWN && (
        <Button variant="ghost" className="min-h-11 self-center rounded-xl text-[15px] font-bold text-link" onClick={() => navigate(PAGE.templates)}>
          See all templates
          <ArrowRight className="size-4" />
        </Button>
      )}
    </section>
  )
}
