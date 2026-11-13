// Dev-only design-system harness (WP0b). Shows the tokens and primitives, plus
// a static mock of the shell + chat idiom described in DESIGN.md, so token
// changes can be reviewed in light/dark, every preset and both densities.
import './design-dev.css'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowUp,
  Bot,
  Brain,
  Check,
  ChevronRight,
  Command,
  FileText,
  Inbox,
  LayoutDashboard,
  MessageSquare,
  Moon,
  Paperclip,
  Settings,
  ShieldCheck,
  Sun,
  Terminal,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { applySeedVars, presetSeedVars } from '@/themes'

const params = new URLSearchParams(location.search)
if (params.get('preset')) applySeedVars(presetSeedVars(params.get('preset')!))
const VIEW = params.get('view') ?? 'gallery'

function toggleMode() {
  document.documentElement.classList.toggle('dark')
}

// ── gallery ───────────────────────────────────────────────────────────────

const SURFACES = ['--background', '--sidebar', '--card', '--popover', '--muted', '--secondary', '--accent']
const TIERS = ['--ui-text-1', '--ui-text-2', '--ui-text-3', '--ui-text-4']
const FILLS = ['--ui-fill-1', '--ui-fill-2', '--ui-fill-3', '--ui-fill-4']
const STROKES = ['--ui-stroke-1', '--ui-stroke-2', '--ui-stroke-3', '--ui-stroke-4']
const SOLIDS: [string, string][] = [
  ['--primary', '--primary-foreground'],
  ['--destructive', '--destructive-foreground'],
  ['--success', '--success-foreground'],
  ['--warning', '--warning-foreground'],
  ['--info', '--info-foreground'],
]

function Swatch({ name, fg }: { name: string; fg?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div
        className="flex h-12 items-center justify-center rounded-md border border-hairline text-xs font-medium"
        style={{ background: `var(${name})`, color: fg ? `var(${fg})` : undefined }}
      >
        {fg ? 'Aa' : ''}
      </div>
      <code className="truncate text-2xs text-muted-foreground">{name}</code>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-border py-8 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-semibold text-tier-2">{title}</h2>
      {children}
    </section>
  )
}

function Gallery() {
  return (
    <div className="aiui-app min-h-svh">
      <div className="mx-auto flex max-w-5xl flex-col px-4 py-10 md:px-8">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Design system</h1>
            <p className="text-sm text-muted-foreground">
              Tokens and primitives. Preset <code>{params.get('preset') ?? 'zinc'}</code>, density{' '}
              <code>{params.get('density') ?? 'comfortable'}</code>.
            </p>
          </div>
          <Button variant="outline" size="icon" aria-label="Toggle theme" onClick={toggleMode}>
            <Sun className="dark:hidden" />
            <Moon className="hidden dark:block" />
          </Button>
        </header>

        <Section title="Surfaces">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-7">
            {SURFACES.map((s) => (
              <Swatch key={s} name={s} />
            ))}
          </div>
        </Section>

        <Section title="Text tiers, fills, strokes">
          <div className="flex flex-col gap-1">
            {TIERS.map((t, i) => (
              <p key={t} style={{ color: `var(${t})` }}>
                Tier {i + 1}: the quick brown fox jumps over the lazy dog <code className="text-xs">{t}</code>
              </p>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
            {[...FILLS, ...STROKES].map((s) => (
              <Swatch key={s} name={s} />
            ))}
          </div>
        </Section>

        <Section title="Solid colours (automatic AA foreground)">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {SOLIDS.map(([bg, fg]) => (
              <Swatch key={bg} name={bg} fg={fg} />
            ))}
          </div>
          <p className="text-sm">
            Body text with a <a className="text-link underline underline-offset-4" href="#">link in the accent</a>{' '}
            and <code className="rounded-xs bg-code px-1 py-0.5 font-mono text-[0.9em]">inline code</code>.
          </p>
        </Section>

        <Section title="Button: variant x size">
          {(['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const).map((variant) => (
            <div key={variant} className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-xs text-muted-foreground">{variant}</span>
              <Button variant={variant} size="xs">
                Extra small
              </Button>
              <Button variant={variant} size="sm">
                Small
              </Button>
              <Button variant={variant}>
                <Check /> Default
              </Button>
              <Button variant={variant} size="lg">
                Large
              </Button>
              <Button variant={variant} size="icon" aria-label="Settings">
                <Settings />
              </Button>
              <Button variant={variant} disabled>
                Disabled
              </Button>
            </div>
          ))}
        </Section>

        <Section title="Inputs, Kbd, Badge">
          <div className="grid max-w-xl gap-3">
            <Input placeholder="Search sessions" />
            <Textarea placeholder="Message" rows={2} />
            <div className="flex flex-wrap items-center gap-2">
              <KbdGroup>
                <Kbd>⌘</Kbd>
                <Kbd>K</Kbd>
              </KbdGroup>
              <Kbd>Esc</Kbd>
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="destructive">Error</Badge>
            </div>
          </div>
        </Section>

        <Section title="Loading: Spinner and Skeleton (never a bare 'Loading...')">
          <div className="flex items-center gap-4">
            <Spinner size="sm" />
            <Spinner />
            <Spinner size="lg" tone="muted" />
            <Button disabled>
              <Spinner /> Saving
            </Button>
          </div>
          <div className="flex max-w-md flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        </Section>

        <Section title="Empty">
          <Empty className="border border-dashed border-border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox />
              </EmptyMedia>
              <EmptyTitle>No sessions yet</EmptyTitle>
              <EmptyDescription>Start a chat and it will show up here.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm">New chat</Button>
            </EmptyContent>
          </Empty>
        </Section>

        <Section title="Floating panel (soft layered shadow + hairline)">
          <div className="max-w-sm rounded-xl border border-hairline bg-popover p-4 shadow-float">
            <p className="text-sm font-medium">Popover surface</p>
            <p className="text-xs text-muted-foreground">--popover, shadow-float, 12px radius</p>
          </div>
        </Section>
      </div>
    </div>
  )
}

// ── shell + chat mock ─────────────────────────────────────────────────────

const NAV = [
  { group: 'Workspace', items: [
    { label: 'Chat', icon: MessageSquare, active: true },
    { label: 'Agents', icon: Bot },
    { label: 'Overview', icon: LayoutDashboard },
  ] },
  { group: 'Data', items: [
    { label: 'Sessions', icon: Inbox },
    { label: 'Logs', icon: Terminal },
    { label: 'Docs', icon: FileText },
    { label: 'Settings', icon: Settings },
  ] },
]

function ToolRow() {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-row-hover">
        <Wrench className="size-4 text-muted-foreground" />
        <span className="font-mono text-xs">web_search</span>
        <span className="rounded-full bg-success-soft px-2 py-0.5 text-2xs font-medium text-success">done</span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">1.2s</span>
        <ChevronRight className={`size-4 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border px-3 py-2">
        <pre className="overflow-x-auto rounded-md bg-code p-2 font-mono text-xs">{`{ "query": "praisonai release notes" }`}</pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Shell() {
  return (
    <SidebarProvider className="aiui-app">
      <Sidebar collapsible="icon">
        <SidebarHeader className="h-12 justify-center px-3">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Bot className="size-3.5" />
            </span>
            <span className="group-data-[collapsible=icon]:hidden">PraisonAI</span>
          </span>
        </SidebarHeader>
        <SidebarContent>
          {NAV.map((g) => (
            <SidebarGroup key={g.group}>
              <SidebarGroupLabel>{g.group}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {g.items.map((it) => (
                    <SidebarMenuItem key={it.label}>
                      <SidebarMenuButton isActive={!!('active' in it && it.active)} tooltip={it.label}>
                        <it.icon />
                        <span>{it.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
        <SidebarFooter />
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-(--z-header) flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
          <SidebarTrigger />
          <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
          <h1 className="text-sm font-medium">Chat</h1>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="outline" size="sm" className="text-muted-foreground">
              <Command /> Search
              <Kbd className="ml-1">⌘K</Kbd>
            </Button>
            <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={toggleMode}>
              <Sun className="dark:hidden" />
              <Moon className="hidden dark:block" />
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mx-auto flex w-full max-w-reading flex-1 flex-col gap-6 px-4 py-8">
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl bg-bubble-user px-4 py-2.5">
                What changed in the last release? Keep it short.
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <button className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                <Brain className="size-4" /> Thought for 4s <ChevronRight className="size-3.5" />
              </button>
              <ToolRow />
              <div className="flex flex-col gap-3">
                <p>
                  The release adds an opt-in <strong>app shell</strong> with a React chat, a token-based theme and a
                  plugin registry. The default dashboard is unchanged.
                </p>
                <ul className="ml-5 list-disc space-y-1 marker:text-muted-foreground">
                  <li>Streaming markdown with lazy code highlighting</li>
                  <li>Inline approvals for tool calls</li>
                </ul>
              </div>

              <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="size-4 text-warning" /> Approval needed
                </div>
                <p className="text-sm text-muted-foreground">
                  <code className="font-mono text-xs">shell.run</code> wants to execute{' '}
                  <code className="rounded-xs bg-code px-1 font-mono text-xs">git push origin main</code>.
                </p>
                <div className="flex gap-2">
                  <Button size="sm">Approve</Button>
                  <Button size="sm" variant="outline">
                    Deny
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="sticky bottom-0 bg-background/90 px-4 pb-4 backdrop-blur">
            <div className="mx-auto w-full max-w-reading">
              <div className="flex flex-col gap-2 rounded-2xl border border-input bg-card p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring">
                <textarea
                  rows={1}
                  placeholder="Message PraisonAI"
                  className="max-h-48 min-h-10 w-full resize-none bg-transparent px-2 py-1.5 outline-none placeholder:text-muted-foreground"
                />
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon-sm" aria-label="Attach">
                    <Paperclip />
                  </Button>
                  <span className="ml-auto text-2xs text-muted-foreground">
                    <Kbd>Enter</Kbd> to send
                  </span>
                  <Button size="icon-sm" aria-label="Send">
                    <ArrowUp />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{VIEW === 'shell' ? <Shell /> : <Gallery />}</StrictMode>,
)
