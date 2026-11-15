/**
 * Guided Studio's Home page (`start`, the layout's home): a welcome in plain
 * words, Start a new chat, popular templates, your recent chats and how a
 * chat works here. A shell-only page owned by builtin.layout-guided; its URL
 * renders under any layout. A lazy chunk of this layout.
 */
import { use, type JSX } from 'react'
import { ArrowRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ShellPage } from '@/sdk/manifest'
import { navigate, useManifest } from '@/sdk/services'
import { useSessions } from '@/app-layouts/kit'
import { PAGE } from './nav'
import { useStartFromTemplate } from './chat'
import { ChatCard, TemplateCard } from './parts'
import { loadTemplates } from './templates'

const HOW = [
  ['Ask in your own words', 'No special commands. Say what you need, like you would to a colleague.'],
  ['Watch each step', 'You see what the agent is doing, in plain words, while it works.'],
  ['You stay in charge', 'Before anything risky, like installing software, it asks for your OK.'],
] as const

function Section({ title, action, children }: { title: string; action?: JSX.Element | null; children: JSX.Element }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-lg font-extrabold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export default function StartPage({ page }: { page: ShellPage }): JSX.Element {
  const templates = use(loadTemplates())
  const start = useStartFromTemplate()
  const sessions = useSessions()
  const manifest = useManifest()
  const listed = (id: string) => !!manifest?.pages.some((p) => p.id === id)
  const site = manifest?.site.title
  const recent = sessions?.state.sessions.slice(0, 4) ?? []
  const newChat = () => {
    sessions?.feed.create()
    navigate(PAGE.chat)
  }
  const link = (id: string, label: string) =>
    listed(id) ? (
      <Button variant="ghost" className="min-h-11 rounded-xl px-2 text-[15px] font-bold text-link" onClick={() => navigate(id)}>
        {label}
        <ArrowRight className="size-4" />
      </Button>
    ) : null

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 text-base sm:px-6" data-guided-page={page.id}>
      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-2xl leading-snug font-extrabold tracking-tight">
          {site ? `Welcome to ${site}` : 'Welcome'}. What would you like to do today?
        </h2>
        <p className="m-0 text-lg text-muted-foreground">Ask in your own words, or start from a template. Every step is explained as it happens.</p>
        <div className="mt-2 flex flex-wrap gap-3">
          {sessions && listed(PAGE.chat) && (
            <Button className="h-12 rounded-2xl px-6 text-lg font-bold shadow-sm" onClick={newChat}>
              <Plus className="size-6" strokeWidth={2.25} />
              Start a new chat
            </Button>
          )}
          {listed(PAGE.templates) && (
            <Button variant="outline" className="h-12 rounded-2xl px-6 text-lg font-bold" onClick={() => navigate(PAGE.templates)}>
              Browse templates
            </Button>
          )}
        </div>
      </section>

      <Section title="Popular templates" action={link(PAGE.templates, 'See all')}>
        <div className="grid gap-3 sm:grid-cols-2">
          {templates.slice(0, 6).map((t) => (
            <TemplateCard key={t.id} t={t} onUse={start} />
          ))}
        </div>
      </Section>

      {recent.length > 0 && (
        <Section title="Pick up where you left off" action={link(PAGE.sessions, 'See all')}>
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
            {recent.map((s) => (
              <li key={s.id} className="rounded-xl border border-border bg-card">
                <ChatCard
                  s={s}
                  active={false}
                  running={sessions?.state.runningIds.has(s.id)}
                  onOpen={(id) => {
                    sessions?.feed.select(id)
                    navigate(PAGE.chat)
                  }}
                />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="How it works">
        <ol className="m-0 grid list-none gap-3 p-0 sm:grid-cols-3">
          {HOW.map(([title, text], i) => (
            <li key={title} className="flex gap-3 rounded-2xl bg-muted p-4">
              <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                {i + 1}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="font-bold">{title}</span>
                <span className="text-sm text-muted-foreground">{text}</span>
              </span>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  )
}
