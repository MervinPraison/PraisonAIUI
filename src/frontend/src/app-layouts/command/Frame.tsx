/**
 * The Command Deck layout frame (chunk `layout-command`; Command.dc.html and
 * CommandPhone.dc.html in the Pro tokens). Keyboard first:
 *
 *   header      brand, the command bar (lf-command-bar: `/` focuses it,
 *               `/…` runs a command, Enter asks), "n approvals waiting",
 *               New chat ⌘N, theme
 *   icon rail   the primary pages, each with a G-prefix key (G R: Runs),
 *               More (the palette) and ⌘/ (all shortcuts)
 *   chat page   session tabs (⌘1–9) with the Run panel toggle (⌘I), the
 *               page, and the run inspector beside it (lf-run-inspector)
 *   status bar  Connected, agent, active runs and approvals, today's tokens and
 *               cost (the run ledger), the shortcut hints
 *   phone       the bar on top with the menu (destinations, approvals and
 *               sessions in a sheet), an n/m session switcher, the page, and
 *               the run inspector's peek with Approve / Deny
 *
 * The chat page draws no session rail (meta.chat.sessions 'tabs'): the tabs
 * are the list. The frame shows approvals itself (meta.approvals 'frame').
 * Every panel reads a layout feed and hides or shows an empty state when its
 * provider is off. A layout imports only the SDK, components/ui, lib and the
 * kit (app-layouts/isolation.test.ts); its features load with import().
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Menu, PanelRight, Plus, SlidersHorizontal, SquarePen, SunMoon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import type { LayoutNavItem, LayoutProps } from '@/sdk/layouts'
import type { ApprovalItem } from '@/sdk/layoutTypes'
import { registerCommand, useManifest } from '@/sdk/services'
import { cn } from '@/lib/utils'
import {
  BrandTile,
  declaredGroups,
  describeCall,
  isMacPlatform,
  isPlainLeftClick,
  isTypingTarget,
  matchesShortcut,
  NavList,
  NavSection,
  PhoneSheet,
  PluginSettingsRow,
  preloadPhoneSheet,
  SessionList,
  useSessions,
} from '@/app-layouts/kit'
import { chatGates, fetchRecentRuns, hasRunLedger, latestAgent, useApprovals, useChat, usePending } from './data'
import { CommandBar, Feature, RunInspector } from './features'
import { RAIL_ICONS } from './icons'
import {
  activeRunIds,
  activityText,
  createGoSequence,
  railItems,
  sessionTabs,
  shortcutRows,
  todayUsage,
  type RailItem,
  type SessionTab,
  type TodayUsage,
} from './model'
import ShortcutSheet from './ShortcutSheet'
import './command.css'


const NO_IDS: ReadonlySet<string> = new Set()

const isDialogTarget = (t: EventTarget | null) =>
  !!(t as Element | null)?.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')

// ── pieces ───────────────────────────────────────────────────────────

function Brand({ chrome, compact = false }: Pick<LayoutProps, 'chrome'> & { compact?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-foreground">
      <BrandTile chrome={chrome} className="size-6.5 rounded-sm text-xs" />
      {!compact && <span className="truncate text-base font-semibold tracking-tight">{chrome.siteTitle}</span>}
    </span>
  )
}

function ItemIcon({ item, className }: { item: LayoutNavItem; className?: string }) {
  const Icon = item.navIcon ? RAIL_ICONS[item.navIcon] : undefined
  if (Icon) return <Icon aria-hidden className={cn('size-4.5 shrink-0', className)} />
  // Never the page's emoji (it renders differently on every OS): its initial.
  const mark = item.title.slice(0, 1).toUpperCase()
  return (
    <span aria-hidden className={cn('flex size-4.5 shrink-0 items-center justify-center text-xs', className)}>
      {mark}
    </span>
  )
}

// 56 px wide (the design), growing to 64 px of the 68 px rail for a longer
// title ("Inspector", "Knowledge") before it truncates.
const railButton = 'group relative flex min-w-14 max-w-16 flex-col px-0.5 items-center gap-0.5 rounded-md pt-1.5 pb-1 text-muted-foreground outline-none hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'

/** A keyboard (lucide's, drawn here so the rail shares no icon chunk with the chat route). */
function KeyboardGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-4.5">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="M10 8h.01M12 12h.01M14 8h.01M16 12h.01M18 8h.01M6 8h.01M7 16h10M8 12h.01" />
    </svg>
  )
}

function RailTip({ text, keys }: { text: string; keys?: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-[calc(100%+0.375rem)] z-20 hidden -translate-y-1/2 items-center gap-2 rounded-sm bg-foreground px-2 py-1 text-2xs font-medium whitespace-nowrap text-background shadow-md group-hover:flex group-focus-visible:flex"
    >
      {text}
      {keys && <span className="font-mono text-[11px] opacity-80">{keys}</span>}
    </span>
  )
}

function Rail({
  items,
  declared,
  footer,
  go,
  runBadge,
  onMore,
  onShortcuts,
  onSettings,
}: {
  items: readonly RailItem[]
  /** The pages of the groups plugins declared, after the primary ones. */
  declared: readonly LayoutNavItem[]
  footer: readonly LayoutNavItem[]
  go(id: string): void
  runBadge: number
  onMore(): void
  onShortcuts(): void
  /** LayoutChrome.openSettings: set while a plugin contributes settings. */
  onSettings?(): void
}) {
  const link = (item: RailItem | LayoutNavItem) => {
    const goKey = 'go' in item && item.go ? `G ${item.go.toUpperCase()}` : undefined
    const badge = item.id === 'runs' ? runBadge : (item.badge ?? 0)
    return (
      <a
        key={item.id}
        href={item.href}
        aria-current={item.active ? 'page' : undefined}
        data-aiui-nav-item={item.id}
        onClick={(e) => {
          if (!isPlainLeftClick(e)) return
          e.preventDefault()
          go(item.id)
        }}
        className={cn(railButton, item.active && 'bg-accent-soft text-link hover:bg-accent-soft hover:text-link')}
      >
        <ItemIcon item={item} />
        <span className={cn('max-w-full truncate text-2xs tracking-tight', item.active ? 'font-semibold' : 'font-medium')}>{item.title}</span>
        {badge > 0 && (
          <span
            className="absolute top-0.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-semibold text-primary-foreground"
            aria-label={item.id === 'runs' ? `${badge} active ${badge === 1 ? 'run' : 'runs'}` : `${badge} new`}
          >
            {badge}
          </span>
        )}
        <RailTip text={item.title} keys={goKey} />
      </a>
    )
  }
  return (
    <nav aria-label="Main" data-command-rail="" className="relative z-10 flex w-17 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-sidebar py-2.5">
      {items.map(link)}
      {declared.map(link)}
      <button type="button" className={railButton} onClick={onMore} aria-label="More pages and commands" aria-keyshortcuts="Meta+K Control+K">
        {/* Drawn here: lucide's Ellipsis is shared with the chat route's lazy chunks. */}
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-4.5">
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="19" cy="12" r="1.5" />
        </svg>
        <span className="text-2xs font-medium">More</span>
        <RailTip text="All pages and commands" keys={isMacPlatform() ? '⌘K' : 'Ctrl K'} />
      </button>
      <span className="flex-1" />
      {footer.map(link)}
      {onSettings && (
        <button type="button" className={railButton} onClick={onSettings} aria-label="Plugin settings" aria-haspopup="dialog" data-aiui-settings-button="">
          <SlidersHorizontal aria-hidden className="size-4.5" />
          <span className="text-2xs font-medium">Settings</span>
          <RailTip text="Plugin settings" />
        </button>
      )}
      <button type="button" className={railButton} onClick={onShortcuts} aria-label="Keyboard shortcuts" aria-keyshortcuts="Meta+/ Control+/" data-command-shortcuts="">
        <KeyboardGlyph />
        <span className="text-2xs font-medium">Shortcuts</span>
        <RailTip text="All keyboard shortcuts" keys={isMacPlatform() ? '⌘/' : 'Ctrl /'} />
      </button>
    </nav>
  )
}

function SessionTabs({
  tabs,
  activeId,
  mainId,
  onSelect,
  onNew,
  inspectorOpen,
  onToggleInspector,
}: {
  tabs: readonly SessionTab[]
  activeId: string | null
  mainId: string
  onSelect(id: string | null): void
  onNew(): void
  inspectorOpen: boolean
  onToggleInspector(): void
}) {
  const mac = isMacPlatform()
  const list = useRef<HTMLDivElement>(null)
  // The open session's tab stays in view (⌘1–9, New chat, a pick from elsewhere).
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeId])
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!dir && e.key !== 'Home' && e.key !== 'End') return
    const all = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])]
    if (!all.length) return
    e.preventDefault()
    const at = all.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (Math.max(0, at) + dir + all.length) % all.length
    all[next].focus()
  }
  return (
    <div className="flex h-10.5 shrink-0 items-stretch border-b border-border bg-sidebar" data-command-tabs="">
      {/* The tabs scroll sideways on their own; New chat and the run panel toggle stay put. */}
      <div ref={list} role="tablist" aria-label="Open sessions" className="flex min-w-0 items-stretch overflow-x-auto [scrollbar-width:none]" onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.id ?? 'new'}
            type="button"
            role="tab"
            aria-selected={t.active}
            aria-controls={mainId}
            tabIndex={t.active ? 0 : -1}
            aria-keyshortcuts={`${mac ? 'Meta' : 'Control'}+${t.key}`}
            data-session-tab={t.id ?? ''}
            onClick={() => onSelect(t.id)}
            className={cn(
              'flex max-w-56 shrink-0 items-center gap-2 border-r border-border px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              t.active ? 'bg-background font-semibold text-foreground shadow-[inset_0_2px_0_var(--primary)]' : 'font-medium text-muted-foreground hover:bg-card hover:text-foreground',
            )}
          >
            <span
              aria-hidden
              className={cn('size-1.5 shrink-0 rounded-full', t.waiting ? 'bg-warning' : t.running ? 'bg-info' : 'bg-transparent')}
            />
            <span className="truncate">{t.title}</span>
            {t.waiting && <span className="sr-only">, waiting for approval</span>}
            {!t.waiting && t.running && <span className="sr-only">, running</span>}
            <Kbd aria-hidden>{mac ? `⌘${t.key}` : `^${t.key}`}</Kbd>
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-label="New chat"
        onClick={onNew}
        className="flex w-10 shrink-0 items-center justify-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <Plus aria-hidden className="size-4" />
      </button>
      <span className="min-w-0 flex-1" />
      <div className="flex shrink-0 items-center gap-2 border-l border-border px-3 text-2xs whitespace-nowrap text-tier-3">
        <Button
          variant="outline"
          size="sm"
          aria-pressed={inspectorOpen}
          aria-keyshortcuts={mac ? 'Meta+I' : 'Control+I'}
          onClick={onToggleInspector}
          data-command-run-toggle=""
          className="bg-card text-foreground"
        >
          <PanelRight aria-hidden />
          Run panel <Kbd>{mac ? '⌘I' : '^I'}</Kbd>
        </Button>
      </div>
    </div>
  )
}

function StatusBar({
  agent,
  activeRuns,
  approvals,
  usage,
  online,
  onShortcuts,
  onPalette,
}: {
  agent?: string
  activeRuns: number
  approvals: number
  usage: TodayUsage | null
  online: boolean
  onShortcuts(): void
  onPalette(): void
}) {
  const mac = isMacPlatform()
  return (
    <footer
      data-command-status=""
      className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-background px-3.5 py-1 text-2xs text-tier-3 tabular-nums"
    >
      <span className="flex items-center gap-1.5" role="status">
        <span aria-hidden className={cn('size-1.5 rounded-full', online ? 'bg-success' : 'bg-destructive')} />
        {online ? 'Connected' : 'Offline'}
      </span>
      {agent && <span>agent {agent}</span>}
      <span>{activityText(activeRuns, approvals)}</span>
      {usage && (
        <span data-command-usage="">
          today {usage.tokens.toLocaleString('en-US')} tok · ${usage.cost.toFixed(usage.cost > 0 && usage.cost < 0.01 ? 5 : 2)}
        </span>
      )}
      <span className="flex-1" />
      <span className="flex items-center gap-1.5 font-sans">
        <button type="button" onClick={onPalette} className="flex items-center gap-1 rounded-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <Kbd>{mac ? '⌘K' : 'Ctrl K'}</Kbd> commands
        </button>
        <button type="button" onClick={onShortcuts} className="flex items-center gap-1 rounded-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          <Kbd>{mac ? '⌘/' : 'Ctrl /'}</Kbd> all shortcuts
        </button>
      </span>
    </footer>
  )
}

/**
 * The phone's approval list (the sheet's "Waiting for you"): each call with
 * Deny and Approve, 44 px targets. Not the kit's ApprovalCard: its icon is
 * one the chat route shares, and a shared icon becomes a chunk of its own.
 */
function PendingApprovals({ items, decide }: { items: readonly ApprovalItem[]; decide(item: ApprovalItem, approved: boolean): Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const act = (item: ApprovalItem, approved: boolean) => async () => {
    setBusy(item.id)
    setError(null)
    try {
      await decide(item, approved)
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'The decision did not reach the server.')
    } finally {
      setBusy(null)
    }
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0" data-command-pending="">
      {items.map((a) => (
        <li key={a.id} data-aiui-approval={a.id} className="flex flex-col gap-2 rounded-lg border bg-card p-2.5 [border-color:var(--ui-warning-line)]">
          <span className="text-xs text-tier-3">
            {a.agentName || 'The agent'} wants to use {a.toolName || 'a tool'}
            {a.riskLevel ? ` · ${a.riskLevel} risk` : ''}
          </span>
          <code className="font-mono text-sm break-all">{describeCall(a)}</code>
          <span className="flex gap-2">
            <Button variant="outline" className="h-11 flex-1 text-base" disabled={busy === a.id} onClick={act(a, false)}>
              Deny
            </Button>
            <Button className="h-11 flex-1 text-base" disabled={busy === a.id} onClick={act(a, true)}>
              Approve
            </Button>
          </span>
        </li>
      ))}
      {error && (
        <li role="alert" className="text-xs text-destructive">
          {error}
        </li>
      )}
    </ul>
  )
}

const BarFallback = ({ touch }: { touch?: boolean }) => (
  <div aria-hidden className={cn('min-w-0 flex-1 border border-input bg-muted', touch ? 'h-11 rounded-lg' : 'h-10 rounded-md')} />
)

// ── state ────────────────────────────────────────────────────────────

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

/** Today's tokens and cost from the run ledger, asked again whenever a run ends; null without the ledger. */
function useTodayUsage(enabled: boolean, activeRuns: number): TodayUsage | null {
  const [usage, setUsage] = useState<TodayUsage | null>(null)
  useEffect(() => {
    if (!enabled || activeRuns > 0) return
    let alive = true
    void fetchRecentRuns().then((runs) => alive && setUsage(todayUsage(runs)))
    return () => {
      alive = false
    }
  }, [enabled, activeRuns])
  return enabled ? usage : null
}

// ── the frame ────────────────────────────────────────────────────────

export default function CommandFrame(props: LayoutProps) {
  const { Outlet, nav, chrome, viewport, pageId, fullBleed, layout } = props
  const phone = viewport === 'phone'
  const spec = layout.available.find((s) => s.id === layout.id)
  const chatPage = spec?.home || 'chat'
  const onChat = pageId === chatPage

  const sessions = useSessions()
  const chat = useChat()
  const approvals = useApprovals()
  const pending = usePending(chat.state, approvals.state)
  const gates = useMemo(() => chatGates(chat.state.messages, chat.state.sessionId), [chat.state.messages, chat.state.sessionId])
  const activeId = sessions?.state.activeId ?? chat.state.sessionId
  const runningIds = sessions?.state.runningIds ?? NO_IDS
  const waitingIds = useMemo(() => new Set(pending.map((a) => a.sessionId).filter((s): s is string => !!s)), [pending])
  // A run paused at a gate is still active (the status bar and the Runs badge count it).
  const activeRuns = useMemo(() => activeRunIds(runningIds, waitingIds).size, [runningIds, waitingIds])
  const tabs = useMemo(
    () => sessionTabs(sessions?.state.sessions ?? [], activeId, runningIds, waitingIds),
    [sessions?.state.sessions, activeId, runningIds, waitingIds],
  )
  const agent = latestAgent(chat.state.messages) ?? sessions?.state.sessions.find((s) => s.id === activeId)?.agent
  const rail = useMemo(() => railItems(nav.primary), [nav.primary])
  const declared = useMemo(() => declaredGroups(nav).flatMap((g) => g.items), [nav])
  const manifest = useManifest()
  const usage = useTodayUsage(hasRunLedger(manifest), activeRuns)
  const online = useOnline()

  const [inspectorChoice, setInspectorChoice] = useState<boolean | null>(null)
  const inspectorOpen = inspectorChoice ?? viewport === 'desktop'
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [shortcutsRequested, setShortcutsRequested] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const openShortcuts = useCallback(() => {
    setShortcutsRequested(true)
    setShortcutsOpen(true)
  }, [])
  const newChat = useCallback(() => {
    sessions?.feed.create()
    nav.go(chatPage)
  }, [sessions, nav, chatPage])
  const selectTab = useCallback(
    (id: string | null) => {
      if (!sessions) return
      if (id === null) sessions.feed.create()
      else sessions.feed.select(id)
      nav.go(chatPage)
    },
    [sessions, nav, chatPage],
  )
  const toggleInspector = useCallback(() => {
    if (!onChat) {
      setInspectorChoice(true)
      nav.go(chatPage)
      return
    }
    setInspectorChoice(!inspectorOpen)
  }, [onChat, inspectorOpen, nav, chatPage])
  const ask = useCallback(
    (text: string) => {
      // Enter in the bar sends; a chat feed without send only fills the composer.
      if (chat.feed?.send) void chat.feed.send(text)
      else if (chat.feed) chat.feed.prefill(text)
      else chrome.openPalette({ query: text })
    },
    [chat.feed, chrome],
  )

  /** Decide an approval: in the open chat through its gate, else through the approvals feed. */
  const decide = useCallback(
    async (item: ApprovalItem, approved: boolean) => {
      const inChat = gates.some((g) => g.id === item.id)
      if (inChat && chat.feed) await chat.feed.resolveApproval(item.id, approved)
      else if (approvals.feed) await (approved ? approvals.feed.approve(item.id) : approvals.feed.deny(item.id))
    },
    [gates, chat.feed, approvals.feed],
  )

  /** The header's "n approvals waiting": open the session it waits in, with the run panel. */
  const reviewApprovals = useCallback(() => {
    const first = pending[0]
    if (!first) return
    if (phone) {
      setMenuOpen(true)
      return
    }
    if (first.sessionId && sessions && first.sessionId !== activeId) sessions.feed.select(first.sessionId)
    setInspectorChoice(true)
    nav.go(chatPage)
  }, [pending, phone, sessions, activeId, nav, chatPage])

  // Frame keys: ⌘N, ⌘1–9, ⌘I, ⌘/, and G-prefix navigation. One listener.
  const keys = useRef({ newChat, selectTab, toggleInspector, openShortcuts, tabs, rail, go: nav.go })
  useEffect(() => {
    keys.current = { newChat, selectTab, toggleInspector, openShortcuts, tabs, rail, go: nav.go }
  })
  useEffect(() => {
    const seq = createGoSequence(() => keys.current.rail)
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const k = keys.current
      const take = (fn: () => void) => {
        e.preventDefault()
        seq.reset()
        fn()
      }
      if (matchesShortcut(e, 'mod+n')) return take(k.newChat)
      if (matchesShortcut(e, 'mod+i')) return take(k.toggleInspector)
      if (matchesShortcut(e, 'mod+/')) return take(k.openShortcuts)
      for (const t of k.tabs) if (matchesShortcut(e, `mod+${t.key}`)) return take(() => k.selectTab(t.id))
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target) || isDialogTarget(e.target)) {
        seq.reset()
        return
      }
      const r = seq.press(e.key)
      if (!r.handled) return
      e.preventDefault()
      if (r.item) k.go(r.item.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Palette commands: the run panel, the shortcuts, Stop, and Approve / Deny for the current gate.
  const gate = gates[gates.length - 1]
  const running = chat.state.isRunning
  useEffect(() => {
    const off = [
      registerCommand({ id: 'command-deck.run-panel', title: 'Show or hide the run panel', group: 'Run', keywords: ['inspector', 'steps', 'cost'], run: () => keys.current.toggleInspector() }),
      registerCommand({ id: 'command-deck.shortcuts', title: 'Keyboard shortcuts', group: 'Run', keywords: ['keys', 'help'], run: () => keys.current.openShortcuts() }),
    ]
    return () => off.forEach((fn) => fn())
  }, [])
  useEffect(() => {
    const off: (() => void)[] = []
    if (running && chat.feed) {
      const feed = chat.feed
      off.push(registerCommand({ id: 'command-deck.stop', title: 'Stop the run', group: 'Run', keywords: ['cancel', 'abort'], run: () => feed.cancel() }))
    }
    if (gate) {
      const call = describeCall(gate)
      off.push(
        registerCommand({ id: 'command-deck.approve', title: `Approve: ${call}`, group: 'Run', keywords: ['approval', 'allow', 'yes'], run: () => decide(gate, true) }),
        registerCommand({ id: 'command-deck.deny', title: `Deny: ${call}`, group: 'Run', keywords: ['approval', 'reject', 'no'], run: () => decide(gate, false) }),
      )
    }
    return () => off.forEach((fn) => fn())
  }, [running, chat.feed, gate, decide])

  const shortcutSections = useMemo(() => shortcutRows(rail, isMacPlatform()), [rail])
  const shortcutDialog = shortcutsRequested && <ShortcutSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} sections={shortcutSections} />
  const bar = (touch: boolean) => (
    <Feature name="command bar" fallback={<BarFallback touch={touch} />}>
      <CommandBar
        openPalette={chrome.openPalette}
        onAsk={ask}
        agent={agent}
        size={touch ? 'touch' : 'default'}
        mac={isMacPlatform()}
        isTypingTarget={isTypingTarget}
        className="flex-1"
      />
    </Feature>
  )
  const main = (
    <main
      id={chrome.mainId}
      tabIndex={-1}
      className={cn('min-h-0 min-w-0 flex-1 bg-background outline-none', fullBleed ? 'flex flex-col overflow-hidden' : 'overflow-y-auto')}
    >
      <Outlet />
    </main>
  )
  const approvalsLabel = `${pending.length} ${pending.length === 1 ? 'approval' : 'approvals'} waiting`

  if (phone) {
    const index = tabs.findIndex((t) => t.active)
    const current = tabs[index]
    return (
      <div data-aiui-layout-frame="command" data-viewport={viewport} className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <header className="flex h-15 shrink-0 items-center gap-1.5 border-b border-border px-2">
          <Button
            variant="ghost"
            size="icon"
            className="relative size-11"
            aria-label={pending.length ? `Open menu: destinations and sessions, ${approvalsLabel}` : 'Open menu: destinations and sessions'}
            aria-haspopup="dialog"
            onPointerEnter={preloadPhoneSheet}
            onFocus={preloadPhoneSheet}
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="size-5" />
            {pending.length > 0 && <span aria-hidden className="absolute top-2 right-2 size-2 rounded-full border-2 border-background bg-warning" />}
          </Button>
          {bar(true)}
          <Button variant="ghost" size="icon" className="size-11" aria-label="New chat" onClick={newChat}>
            <SquarePen className="size-5" />
          </Button>
        </header>
        {onChat && sessions && (
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-sidebar pr-2 pl-4">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={`Switch session, ${tabs.length} open`}
              onClick={() => setMenuOpen(true)}
              className="flex h-11 min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-command-switcher=""
            >
              <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', current?.waiting ? 'bg-warning' : current?.running ? 'bg-info' : 'bg-transparent')} />
              <span className="truncate text-base font-semibold">{current?.title ?? 'New chat'}</span>
            </button>
            <span className="shrink-0 rounded-sm border border-input px-1.5 font-mono text-2xs leading-5 text-tier-3" aria-label={`Session ${index + 1} of ${tabs.length}`}>
              {index + 1}/{tabs.length}
            </span>
          </div>
        )}
        {main}
        {onChat && (
          <Feature name="run inspector">
            <RunInspector variant="sheet" isTypingTarget={isTypingTarget} />
          </Feature>
        )}
        {/*
          The sheet's body is a scrolling flex column. Its sections keep their
          full height (shrink-0) and the body scrolls; a section that may shrink
          (the kit's NavSection and SessionList are min-h-0) is squeezed to its
          heading and draws its content over the links below it.
        */}
        <PhoneSheet open={menuOpen} onOpenChange={setMenuOpen} title="Menu and sessions" header={<Brand chrome={chrome} />}>
          {pending.length > 0 && (
            <div className="shrink-0" data-command-waiting="">
              <NavSection title="Waiting for you" size="touch">
                <PendingApprovals items={pending} decide={decide} />
              </NavSection>
            </div>
          )}
          <NavList items={rail} go={nav.go} onNavigate={() => setMenuOpen(false)} size="touch" aria-label="Primary" renderIcon={(i) => <ItemIcon item={i} className="text-muted-foreground" />} />
          {nav.groups.map((g) => (
            <NavSection key={g.name} title={g.name} folded={!g.declared || g.folded} size="touch">
              <NavList items={g.items} go={nav.go} onNavigate={() => setMenuOpen(false)} size="touch" />
            </NavSection>
          ))}
          <SessionList title="Sessions" size="touch" limit={20} className="shrink-0" onOpen={() => {
            nav.go(chatPage)
            setMenuOpen(false)
          }} />
          <NavList items={nav.footer} go={nav.go} onNavigate={() => setMenuOpen(false)} size="touch" />
          <PluginSettingsRow chrome={chrome} size="touch" onNavigate={() => setMenuOpen(false)} className="shrink-0" />
          <Button variant="ghost" className="mt-auto h-11 justify-start text-muted-foreground" onClick={chrome.toggleColorMode}>
            <SunMoon />
            Switch light or dark theme
          </Button>
          <chrome.Slot name="sidebar:footer" />
        </PhoneSheet>
      </div>
    )
  }

  return (
    <div
      data-aiui-layout-frame="command"
      data-viewport={viewport}
      data-run-panel={onChat && inspectorOpen ? 'open' : undefined}
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-border bg-background px-3.5 py-2">
        <a
          href="/"
          aria-label={`${chrome.siteTitle} home`}
          onClick={(e) => {
            if (!isPlainLeftClick(e)) return
            e.preventDefault()
            nav.go(chatPage)
          }}
          className="shrink-0 rounded-md pr-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Brand chrome={chrome} />
        </a>
        <div className="mx-auto flex min-w-0 max-w-reading flex-[1_1_22rem]">{bar(false)}</div>
        <div className="flex shrink-0 items-center gap-2">
          {pending.length > 0 && (
            <Button
              variant="outline"
              onClick={reviewApprovals}
              data-command-approvals=""
              className="bg-warning-soft text-warning [border-color:var(--ui-warning-line)] hover:bg-warning-soft hover:text-warning"
            >
              <span aria-hidden className="size-1.5 rounded-full bg-warning" />
              {approvalsLabel}
            </Button>
          )}
          <Button variant="outline" onClick={newChat} aria-keyshortcuts={isMacPlatform() ? 'Meta+N' : 'Control+N'}>
            <Plus aria-hidden />
            New chat <Kbd>{isMacPlatform() ? '⌘N' : '^N'}</Kbd>
          </Button>
          <Button variant="ghost" size="icon" aria-label="Switch light or dark theme" onClick={chrome.toggleColorMode} className="text-muted-foreground">
            <SunMoon />
          </Button>
          <chrome.Slot name="header:actions" className="flex items-center gap-1" />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <Rail items={rail} declared={declared} footer={nav.footer} go={nav.go} runBadge={activeRuns} onMore={() => chrome.openPalette()} onShortcuts={openShortcuts} onSettings={chrome.openSettings} />
        <div className="flex min-w-0 flex-1 flex-col">
          {onChat && sessions && (
            <SessionTabs
              tabs={tabs}
              activeId={activeId}
              mainId={chrome.mainId}
              onSelect={selectTab}
              onNew={newChat}
              inspectorOpen={inspectorOpen}
              onToggleInspector={toggleInspector}
            />
          )}
          <div className="flex min-h-0 flex-1">
            {main}
            {onChat && inspectorOpen && (
              <Feature name="run inspector">
                <RunInspector variant="panel" isTypingTarget={isTypingTarget} className="w-90 shrink-0 border-l border-border" />
              </Feature>
            )}
          </div>
        </div>
      </div>
      <StatusBar
        agent={agent}
        activeRuns={activeRuns}
        approvals={pending.length}
        usage={usage}
        online={online}
        onShortcuts={openShortcuts}
        onPalette={() => chrome.openPalette()}
      />
      {shortcutDialog}
    </div>
  )
}
