/**
 * React chat page for the app shell (ADR-0001 §5):
 *   export default function ChatPage(p: { page: ShellPage }): JSX.Element
 *
 * Session rail (list, search, new, rename, delete), agent picker (with
 * ?agent= preselect), starters, the thread and composer, and a connection
 * badge. Listens for `aiui:prefill-composer` and `aiui:session-select`.
 * The selected session is mirrored into ?session= so a reload restores it.
 * The session list and selection live in ./sessionsStore, shared with the
 * SessionsFeed a layout frame reads.
 *
 * Inside a layout (ADR 0003 §1.3) the page reads `useLayout()?.meta.chat`:
 *   sessions  'page' (default) keeps the rail; 'frame' | 'tabs' | 'none' hide it
 *   thread / approvals  passed to the Thread (variant, approval presentation)
 *   aside     a side panel (desktop), collapsed on a tablet, a Chat | <label>
 *             switch on a phone
 *   turnHeader / turnFooter / empty  regions inside the Thread
 * All of it is drawn by the lazy presentation host (./presentation/host),
 * which loads each feature as a lazy chunk again; without a layout none of
 * it is downloaded.
 *
 * The page does not register itself; the shell calls registerChatPage()
 * from ./register.
 */
import { lazy, Suspense, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type JSX } from 'react'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { PanelLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLayout } from '@/sdk/layouts'
import type { ShellPage } from '@/sdk/manifest'
import { useManifest } from '@/sdk/services'
import { fetchAgents, fetchStarters, type ChatAgent, type ChatSession } from './api'
import type { ConnectionStatus } from './protocol'
import { takePendingPrefill, takePendingSessionSelect } from './register'
import { SessionRail } from './SessionRail'
import { chatTransport, sessionsStore } from './sessionsStore'
import { threadStore } from './store'
import { Thread, type PresentationHost, type ThreadPresentation } from './Thread'
import type { AiuiTransport } from './transports'
import { DEFAULT_STARTERS, fillPrompts } from './starters'
import { connectionLabel } from './util'
import { useAiuiRuntime, type AiuiStarter } from './useAiuiRuntime'

/** Phone rail (radix Dialog sheet): loaded on the first tap of "Show chats". */
const loadRailSheet = () => import('./RailSheet')
const RailSheet = lazy(loadRailSheet)
function preloadRailSheet() {
  void loadRailSheet().catch(() => {
    /* retried on open */
  })
}

/**
 * The layout presentation host, loaded the first time a layout declares
 * `meta.chat` (the page suspends for it once). A chunk that fails to load
 * resolves to null: the default chat, with a warning.
 */
let presentationHost: Promise<PresentationHost | null> | null = null
const loadPresentationHost = () =>
  (presentationHost ??= import('./presentation/host').catch((err: unknown) => {
    console.warn('[aiui chat] layout presentation failed to load', err)
    return null
  }))

/**
 * An unsent draft survives leaving and coming back to /chat (the open
 * conversation is kept by ./sessionsStore; an explicit ?session= still
 * wins); "New chat" clears it.
 */
const drafts = new Map<string, string>()
const draftKey = (sid: string | null) => sid ?? ''

const RAIL_PREF_KEY = 'aiui-chat-rail-hidden'

function readRailHidden(): boolean {
  try {
    return localStorage.getItem(RAIL_PREF_KEY) === '1'
  } catch {
    return false
  }
}

function writeRailHidden(hidden: boolean) {
  try {
    localStorage.setItem(RAIL_PREF_KEY, hidden ? '1' : '0')
  } catch {
    /* per-viewer convenience only */
  }
}

function readUrlState(): { session: string | null; agent: string | null } {
  try {
    const q = new URLSearchParams(window.location.search)
    return { session: q.get('session') || null, agent: q.get('agent') || null }
  } catch {
    return { session: null, agent: null }
  }
}

/** `quiet`: inside a layout the badge is for screen readers only (the frame shows the state; a drop is a banner). */
function ConnectionBadge({ status, transport, quiet }: { status?: ConnectionStatus; transport: AiuiTransport; quiet?: boolean }) {
  if (!status) return null
  const { label, short, tone } = connectionLabel(status, transport)
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted-foreground', quiet && 'sr-only')}
      data-connection={status}
      role="status"
      aria-label={`Connection: ${label}`}
      title={label}
    >
      <span
        className={cn(
          'size-2 rounded-full',
          tone === 'ok' ? 'bg-success' : tone === 'down' ? 'bg-destructive' : 'bg-warning',
          status === 'connecting' && 'motion-safe:animate-pulse',
        )}
        aria-hidden
      />
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden" aria-hidden>{short}</span>
    </span>
  )
}

function AgentPicker({ agents, value, onChange }: { agents: ChatAgent[]; value: string; onChange: (v: string) => void }) {
  if (!agents.length) return null
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Agent"
      title={agents.find((a) => a.name === value)?.description}
      className="h-8 max-w-[9rem] min-w-0 shrink truncate rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-none hover:bg-muted/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 sm:max-w-[14rem]"
    >
      <option value="">Default agent</option>
      {agents.map((a) => (
        <option key={a.name} value={a.name}>
          {a.name}
        </option>
      ))}
    </select>
  )
}

export interface ChatPageProps {
  page: ShellPage
  /** Override the transport (dev harness, tests). Defaults to WS with SSE fallback. */
  transport?: AiuiTransport
}

export default function ChatPage({ page, transport: transportProp }: ChatPageProps): JSX.Element {
  const [transport] = useState(() => transportProp ?? chatTransport())
  // `at`: the store's selection counter when the page mounted.
  const [initial] = useState(() => ({ ...readUrlState(), at: sessionsStore.get().selection }))
  const sessions = useSyncExternalStore(sessionsStore.subscribe, sessionsStore.get, sessionsStore.get)
  // ?session= wins over the session kept from the last visit. It is applied
  // to the store before paint, and read from `initial` until the store's
  // selection has moved on from `at`.
  const sessionId = initial.session && sessions.selection === initial.at ? initial.session : sessions.activeId
  useLayoutEffect(() => {
    if (initial.session) sessionsStore.select(initial.session)
  }, [initial])
  const [agents, setAgents] = useState<ChatAgent[]>([])
  const [agent, setAgent] = useState('')
  const [starters, setStarters] = useState<AiuiStarter[] | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [railOpen, setRailOpen] = useState(false)
  // The sheet chunk is mounted after the first open only (as the shell does with MobileNav).
  const [railRequested, setRailRequested] = useState(false)
  const railButton = useRef<HTMLButtonElement>(null)
  const [railHidden, setRailHidden] = useState(readRailHidden)
  // A notice belongs to the chat it was raised in: opening another session
  // (here or from a layout frame's list) clears it.
  const [notice, setNotice] = useState<string | null>(null)
  const [noticeFor, setNoticeFor] = useState(sessionId)
  if (noticeFor !== sessionId) {
    setNoticeFor(sessionId)
    setNotice(null)
  }
  const running = useSyncExternalStore(threadStore.subscribeRunning, threadStore.runningSessions, threadStore.runningSessions)
  // The shell header owns the page <h1>; with it hidden (layout.pageHeader: false) the chat title is the h1.
  const manifest = useManifest()
  const Heading = manifest?.layout.pageHeader === false ? 'h1' : 'h2'

  // A layout's presentation of the chat (null: the classic frame, the page as before).
  const chat = useLayout()?.meta.chat
  const ownRail = !chat?.sessions || chat.sessions === 'page'
  // The aside's open/close toggle is drawn into the header from its own chunk.
  const [asideSlot, setAsideSlot] = useState<HTMLElement | null>(null)
  const host = chat ? use(loadPresentationHost()) : null
  const presentation = useMemo<ThreadPresentation | undefined>(() => chat && { chat, host, sessionId }, [chat, host, sessionId])

  // Initial data: sessions, agents (with ?agent= preselect), starters.
  useEffect(() => {
    let alive = true
    void sessionsStore.refresh()
    void fetchAgents()
      .then((list) => {
        if (!alive) return
        setAgents(list)
        const want = initial.agent?.toLowerCase()
        const hit = want ? list.find((a) => a.name.toLowerCase() === want) : undefined
        if (hit) setAgent(hit.name)
      })
      .catch(() => undefined)
    void fetchStarters()
      .then((list) => alive && setStarters(list.length ? list : DEFAULT_STARTERS))
      .catch(() => alive && setStarters(DEFAULT_STARTERS))
    return () => {
      alive = false
    }
  }, [initial.agent])

  // Mirror the selection into ?session= (and drop a consumed ?agent=).
  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      if (sessionId) url.searchParams.set('session', sessionId)
      else url.searchParams.delete('session')
      url.searchParams.delete('agent')
      if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url)
    } catch {
      /* non-browser URL: nothing to mirror */
    }
  }, [sessionId])

  const select = useCallback((id: string | null) => {
    sessionsStore.select(id)
    setRailOpen(false)
    setNotice(null)
  }, [])

  const clearNotice = useCallback(() => setNotice(null), [])

  const { runtime, thread, setComposerText, sessionId: threadSessionId } = useAiuiRuntime({
    sessionId,
    transport,
    agentName: agent || undefined,
    starters,
    onSessionCreated: sessionsStore.noteCreated,
    onError: setNotice,
    onSend: clearNotice,
    // Servers that report it (site.feedbackEnabled); older ones are found out on the first 403.
    feedback: manifest?.site.feedbackEnabled !== false,
  })

  // An unsent draft is kept when the page unmounts and put back when it
  // returns (a prefill event, handled below, still wins).
  const draftSession = useRef(sessionId)
  useEffect(() => {
    draftSession.current = sessionId
  }, [sessionId])
  useEffect(() => {
    const key = draftKey(draftSession.current)
    const saved = drafts.get(key)
    drafts.delete(key)
    if (saved) setComposerText(saved)
    return () => {
      let text = ''
      try {
        text = runtime.thread.composer.getState().text
      } catch {
        /* runtime already disposed */
      }
      if (text.trim()) drafts.set(draftKey(draftSession.current), text)
    }
  }, [runtime, setComposerText])

  // Window events from the shell and other pages.
  useEffect(() => {
    // Events dispatched while the chat chunk was still loading (see ./register).
    const bufferedSession = takePendingSessionSelect()
    if (bufferedSession) sessionsStore.select(bufferedSession)
    const buffered = takePendingPrefill()
    if (buffered) setComposerText(buffered)
    const onPrefill = (e: Event) => {
      const text = (e as CustomEvent<{ text?: unknown }>).detail?.text
      if (typeof text !== 'string' || !text) return
      takePendingPrefill() // handled here; do not replay it on the next mount
      setComposerText(text)
    }
    const onSelect = (e: Event) => {
      const id = (e as CustomEvent<{ sessionId?: unknown }>).detail?.sessionId
      // `sessionId: null` is "New chat" (builtin.chat startNewChat).
      if (id === null) {
        select(null)
        return
      }
      if (typeof id !== 'string' || !id) return
      takePendingSessionSelect() // handled here; do not replay it on the next mount
      select(id)
    }
    // Approval records from the legacy approval stream (approvalUi 'event-only'):
    // fill in a gate the chat stream could not describe (older WS servers).
    const onApproval = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail
      if (detail && typeof detail === 'object') threadStore.injectApproval(detail as Record<string, unknown>)
    }
    window.addEventListener('aiui:prefill-composer', onPrefill)
    window.addEventListener('aiui:session-select', onSelect)
    window.addEventListener('aiui:approval-required', onApproval)
    return () => {
      window.removeEventListener('aiui:prefill-composer', onPrefill)
      window.removeEventListener('aiui:session-select', onSelect)
      window.removeEventListener('aiui:approval-required', onApproval)
    }
  }, [setComposerText, select])

  const fill = useMemo(() => fillPrompts(starters), [starters])

  const current = sessionId ? sessions.sessions.find((s) => s.id === sessionId) : undefined
  const heading = current?.title ?? (sessionId ? 'Chat' : 'New chat')

  const toggleRail = () => {
    setRailHidden((h) => {
      writeRailHidden(!h)
      return !h
    })
  }

  const railProps = {
    sessions: sessions.sessions as ChatSession[],
    loading: sessions.loading,
    error: sessions.error,
    activeId: sessionId,
    runningIds: running,
    query,
    onQuery: setQuery,
    onSelect: (id: string) => select(id),
    onNew: () => select(null),
    onRename: sessionsStore.rename,
    onDelete: (id: string) => sessionsStore.remove(id, transport),
  }

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 overflow-hidden bg-background text-foreground" data-aiui-chat data-page-id={page.id}>
      {ownRail && !railHidden && <SessionRail {...railProps} className="hidden shrink-0 border-r border-border/70 lg:flex" />}
      {railRequested && (
        <Suspense fallback={null}>
          <RailSheet open={railOpen} onOpenChange={setRailOpen} rail={railProps} returnFocus={railButton} />
        </Suspense>
      )}
      <section className="@container flex min-h-0 min-w-0 flex-1 flex-col" aria-label={page.title || 'Chat'}>
        {/* The title lines up with the thread column; the rail toggle sits in the gutter. */}
        <header className="relative flex h-12 shrink-0 items-center px-4 sm:px-6">
          {ownRail && (
            <div className="absolute top-2 left-2 flex sm:left-3">
              <Button
                ref={railButton}
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground lg:hidden"
                onClick={() => {
                  setRailRequested(true)
                  setRailOpen(true)
                }}
                onPointerEnter={preloadRailSheet}
                onFocus={preloadRailSheet}
                aria-label="Show chats"
                aria-haspopup="dialog"
                aria-expanded={railOpen}
              >
                <PanelLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="hidden text-muted-foreground hover:text-foreground lg:inline-flex"
                onClick={toggleRail}
                aria-label={railHidden ? 'Show chats' : 'Hide chats'}
                aria-pressed={!railHidden}
              >
                <PanelLeft />
              </Button>
            </div>
          )}
          <div className={cn('mx-auto flex w-full max-w-[760px] min-w-0 items-center gap-1.5', ownRail && 'pl-7 @[54rem]:pl-0')} data-chat-header-column>
            <Heading className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" data-chat-title>{heading}</Heading>
            <AgentPicker agents={agents} value={agent} onChange={setAgent} />
            <ConnectionBadge status={thread.signals.connection} transport={transport} quiet={!!chat} />
            {chat?.aside && <span className="contents" ref={setAsideSlot} />}
          </div>
        </header>
        <div className="min-h-0 min-w-0 flex-1">
          <AssistantRuntimeProvider runtime={runtime}>
            <Thread
              sessionId={threadSessionId}
              loading={thread.isLoading && !thread.messages.length}
              subtitle={agent ? `Chatting with ${agent}` : agents.length ? 'Default agent' : undefined}
              notice={notice ? { text: notice, onDismiss: clearNotice } : null}
              fillPrompts={fill}
              presentation={presentation}
            />
          </AssistantRuntimeProvider>
        </div>
      </section>
      {presentation?.host && <presentation.host.Aside presentation={presentation} slot={asideSlot} />}
    </div>
  )
}
