/**
 * React chat page for the app shell (ADR-0001 §5):
 *   export default function ChatPage(p: { page: ShellPage }): JSX.Element
 *
 * Session rail (list, search, new, rename, delete), agent picker (with
 * ?agent= preselect), starters, the thread and composer, and a connection
 * badge. Listens for `aiui:prefill-composer` and `aiui:session-select`.
 * The selected session is mirrored into ?session= so a reload restores it.
 *
 * The page does not register itself; the shell calls registerChatPage()
 * from ./register.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type JSX } from 'react'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import { PanelLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ShellPage } from '@/sdk/manifest'
import { deleteSession, fetchAgents, fetchSessions, fetchStarters, renameSession, type ChatAgent, type ChatSession } from './api'
import type { ConnectionStatus } from './protocol'
import { takePendingPrefill, takePendingSessionSelect } from './register'
import { SessionRail } from './SessionRail'
import { addLocalSession, markListed, mergeSessions, removeLocalSession, renameLocalSession, type LocalSessions } from './sessionList'
import { threadStore } from './store'
import { Thread } from './Thread'
import { createAutoTransport, type AiuiTransport } from './transports'
import { DEFAULT_STARTERS, fillPrompts } from './starters'
import { useAiuiRuntime, type AiuiStarter } from './useAiuiRuntime'

/** Phone rail (radix Dialog sheet): loaded on the first tap of "Show chats". */
const loadRailSheet = () => import('./RailSheet')
const RailSheet = lazy(loadRailSheet)
function preloadRailSheet() {
  void loadRailSheet().catch(() => {
    /* retried on open */
  })
}

let sharedTransport: AiuiTransport | null = null
/** One WebSocket for every chat view; streams outlive the page component. */
function getSharedTransport(): AiuiTransport {
  return (sharedTransport ??= createAutoTransport())
}

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

function ConnectionBadge({ status, kind }: { status?: ConnectionStatus; kind: 'ws' | 'sse' }) {
  if (!status) return null
  const label = status === 'open' ? 'Connected' : status === 'connecting' ? 'Connecting' : kind === 'sse' ? 'Offline, using HTTP' : 'Offline'
  const short = status === 'open' ? 'Live' : status === 'connecting' ? '…' : 'Offline'
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted-foreground"
      data-connection={status}
      role="status"
      aria-label={`Connection: ${label}`}
      title={label}
    >
      <span
        className={cn(
          'size-2 rounded-full',
          status === 'open' ? 'bg-success' : status === 'connecting' ? 'bg-warning motion-safe:animate-pulse' : 'bg-destructive',
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
  const [transport] = useState(() => transportProp ?? getSharedTransport())
  const [initial] = useState(readUrlState)
  const [sessionId, setSessionId] = useState<string | null>(initial.session)
  const [agents, setAgents] = useState<ChatAgent[]>([])
  const [agent, setAgent] = useState('')
  const [starters, setStarters] = useState<AiuiStarter[] | undefined>(undefined)
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [localSessions, setLocalSessions] = useState<LocalSessions>({})
  const [query, setQuery] = useState('')
  const [railOpen, setRailOpen] = useState(false)
  // The sheet chunk is mounted after the first open only (as the shell does with MobileNav).
  const [railRequested, setRailRequested] = useState(false)
  const railButton = useRef<HTMLButtonElement>(null)
  const [railHidden, setRailHidden] = useState(readRailHidden)
  const [notice, setNotice] = useState<string | null>(null)
  const running = useSyncExternalStore(threadStore.subscribeRunning, threadStore.runningSessions)

  // Chats deleted during this visit. A list request that was already in flight
  // when the delete finished must not bring them back.
  const deletedIds = useRef(new Set<string>())
  const refreshSeq = useRef(0)

  const refreshSessions = useCallback(async () => {
    const seq = ++refreshSeq.current
    try {
      const list = (await fetchSessions()).filter((s) => !deletedIds.current.has(s.id))
      if (seq !== refreshSeq.current) return // a newer refresh owns the list
      setSessions(list)
      setLocalSessions((local) => markListed(local, list))
      setSessionsError(null)
    } catch {
      if (seq === refreshSeq.current) setSessionsError('Chats could not be loaded')
    } finally {
      if (seq === refreshSeq.current) setSessionsLoading(false)
    }
  }, [])

  // Initial data: sessions, agents (with ?agent= preselect), starters.
  useEffect(() => {
    let alive = true
    void refreshSessions()
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
  }, [refreshSessions, initial.agent])

  // A finished turn may have created or retitled a session.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = threadStore.onSettled(() => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => void refreshSessions(), 300)
    })
    return () => {
      off()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [refreshSessions])

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
    setSessionId(id)
    setRailOpen(false)
    setNotice(null)
  }, [])

  const clearNotice = useCallback(() => setNotice(null), [])

  const onSessionCreated = useCallback((id: string) => {
    const first = threadStore.get(id).messages.find((m) => m.role === 'user')
    const text = first?.parts.map((p) => (p.type === 'text' ? p.text : '')).join(' ').replace(/\s+/g, ' ').trim()
    if (text) setLocalSessions((local) => addLocalSession(local, id, text.length > 60 ? `${text.slice(0, 57)}…` : text))
    setSessionId(id)
  }, [])

  const { runtime, thread, setComposerText, sessionId: threadSessionId } = useAiuiRuntime({
    sessionId,
    transport,
    agentName: agent || undefined,
    starters,
    onSessionCreated,
    onError: setNotice,
    onSend: clearNotice,
  })

  // Window events from the shell and other pages.
  useEffect(() => {
    // Events dispatched while the chat chunk was still loading (see ./register).
    const bufferedSession = takePendingSessionSelect()
    if (bufferedSession) select(bufferedSession)
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

  const rename = useCallback(async (id: string, title: string) => {
    await renameSession(id, title)
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, title, untitled: false } : s)))
    // A chat started here may not be listed by the server yet; its row comes from the local entry.
    setLocalSessions((local) => renameLocalSession(local, id, title))
  }, [])

  const remove = useCallback(async (id: string) => {
    if (threadStore.get(id).isRunning) await threadStore.cancel(transport, id)
    await deleteSession(id)
    deletedIds.current.add(id) // a list fetched before the delete still has it
    threadStore.drop(id)
    setSessions((list) => list.filter((s) => s.id !== id))
    // A chat started here is also listed from its local entry; drop that too.
    setLocalSessions((local) => removeLocalSession(local, id))
    setSessionId((cur) => (cur === id ? null : cur))
  }, [transport])

  // Server list + sessions created here that the server has not listed yet.
  const shownSessions = useMemo(() => mergeSessions(sessions, localSessions), [sessions, localSessions])

  const fill = useMemo(() => fillPrompts(starters), [starters])

  const current = sessionId ? shownSessions.find((s) => s.id === sessionId) : undefined
  const heading = current?.title ?? (sessionId ? 'Chat' : 'New chat')

  const toggleRail = () => {
    setRailHidden((h) => {
      writeRailHidden(!h)
      return !h
    })
  }

  const railProps = {
    sessions: shownSessions,
    loading: sessionsLoading,
    error: sessionsError,
    activeId: sessionId,
    runningIds: running,
    query,
    onQuery: setQuery,
    onSelect: (id: string) => select(id),
    onNew: () => select(null),
    onRename: rename,
    onDelete: remove,
  }

  return (
    <div className="relative flex h-full min-h-0 w-full min-w-0 overflow-hidden bg-background text-foreground" data-aiui-chat data-page-id={page.id}>
      {!railHidden && <SessionRail {...railProps} className="hidden shrink-0 border-r border-border/70 lg:flex" />}
      {railRequested && (
        <Suspense fallback={null}>
          <RailSheet open={railOpen} onOpenChange={setRailOpen} rail={railProps} returnFocus={railButton} />
        </Suspense>
      )}
      <section className="@container flex min-h-0 min-w-0 flex-1 flex-col" aria-label={page.title || 'Chat'}>
        {/* The title lines up with the thread column; the rail toggle sits in the gutter. */}
        <header className="relative flex h-12 shrink-0 items-center px-4 sm:px-6">
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
          <div className="mx-auto flex w-full max-w-[760px] min-w-0 items-center gap-1.5 pl-7 @[54rem]:pl-0" data-chat-header-column>
            <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{heading}</h1>
            <AgentPicker agents={agents} value={agent} onChange={setAgent} />
            <ConnectionBadge status={thread.signals.connection} kind={transport.kind} />
          </div>
        </header>
        <div className="min-h-0 min-w-0 flex-1">
          <AssistantRuntimeProvider runtime={runtime}>
            <Thread
              sessionId={threadSessionId}
              loading={thread.isLoading && !thread.messages.length}
              subtitle={agent ? `Chatting with ${agent}` : agents.length ? 'Default agent' : undefined}
              notice={notice ? { text: notice, onDismiss: () => setNotice(null) } : null}
              fillPrompts={fill}
              hasMore={thread.hasMore}
              loadingEarlier={thread.isLoadingEarlier}
              onLoadEarlier={() => {
                if (threadSessionId) void threadStore.loadEarlier(threadSessionId)
              }}
            />
          </AssistantRuntimeProvider>
        </div>
      </section>
    </div>
  )
}
