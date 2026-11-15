/**
 * chat-engine/feeds.ts — the chat's layout data feeds (ADR 0003 §1.1):
 *
 *   createSessionsFeed()  SessionsFeed over ./sessionsStore (+ running ids)
 *   createChatFeed()      ChatFeed over ./store for the open session (send,
 *                         prefill, cancel, approvals)
 *
 * builtin.chat provides them lazily (`provideLayoutData('sessions', () =>
 * import('@/chat-engine/feeds').then(...))`), so this module loads only when
 * a layout frame reads one. It is light on purpose: no assistant-ui, no
 * Thread, no ChatPage, no runtime hook (feeds.test.ts walks its imports), so
 * a frame that reads a feed never pulls the chat route in.
 *
 * Opening the chat page is the caller's job (`show`): the feeds do not know
 * the shell's router.
 */
import type { ChatFeed, ChatState, SessionsFeed, SessionsState } from '@/sdk/layoutTypes'
import type { AiuiTransport } from './transports'
import { chatTransport, sessionsStore } from './sessionsStore'
import { threadStore } from './store'

export const PREFILL_EVENT = 'aiui:prefill-composer'

/** A client-minted session id (useAiuiRuntime mints the same kind; both /run and the WS accept it). */
const newSessionId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

export interface FeedOptions {
  /** Bring the chat page on screen (navigate to it when it is not). */
  show?: () => void
  /** The chat transport (default: the shared one, ./sessionsStore chatTransport). */
  transport?: AiuiTransport
}

/** The session list, the open session and the sessions with a live run. */
export function createSessionsFeed({ show }: FeedOptions = {}): SessionsFeed {
  let cache: { snap: ReturnType<typeof sessionsStore.get>; running: ReadonlySet<string>; state: SessionsState } | null = null
  let requested = false
  const select = (id: string | null) => {
    sessionsStore.select(id)
    show?.()
  }
  return {
    get() {
      const snap = sessionsStore.get()
      const running = threadStore.runningSessions()
      if (cache?.snap !== snap || cache.running !== running) {
        cache = {
          snap,
          running,
          state: { sessions: snap.sessions, activeId: snap.activeId, runningIds: running, loading: snap.loading, error: snap.error ?? undefined },
        }
      }
      return cache.state
    },
    subscribe(fn) {
      const offSessions = sessionsStore.subscribe(fn)
      const offRunning = threadStore.subscribeRunning(fn)
      // A frame may draw the list before the chat page ever loaded it.
      if (!requested && sessionsStore.get().loading) {
        requested = true
        void sessionsStore.refresh()
      }
      return () => {
        offSessions()
        offRunning()
      }
    },
    select,
    create: () => select(null),
    rename: (id, title) => sessionsStore.rename(id, title),
    remove: (id) => sessionsStore.remove(id, chatTransport()),
    refresh: () => sessionsStore.refresh(),
  }
}

/** The open session's messages and run state, and the actions a frame may take on them. */
export function createChatFeed({ show, transport: transportOpt }: FeedOptions = {}): ChatFeed {
  const transport = () => transportOpt ?? chatTransport()
  let cache: { sid: string | null; thread: ReturnType<typeof threadStore.get>; state: ChatState } | null = null
  const activeId = () => sessionsStore.get().activeId
  /** The persisted history of a session a frame shows before the chat page has. */
  const ensureLoaded = (sid: string | null) => {
    if (sid) void threadStore.load(sid)
  }
  return {
    get() {
      const sid = activeId()
      const thread = threadStore.get(sid)
      if (cache?.sid !== sid || cache.thread !== thread) {
        cache = { sid, thread, state: { sessionId: sid, messages: thread.messages, isRunning: thread.isRunning, activeRunId: thread.activeRunId, ...(thread.signals.connection ? { connection: thread.signals.connection } : {}) } }
      }
      return cache.state
    },
    subscribe(fn) {
      let sid = activeId()
      let offThread = threadStore.subscribe(sid, fn)
      ensureLoaded(sid)
      const offSessions = sessionsStore.subscribe(() => {
        const next = activeId()
        if (next !== sid) {
          offThread()
          sid = next
          offThread = threadStore.subscribe(sid, fn)
          ensureLoaded(sid)
        }
        fn()
      })
      return () => {
        offSessions()
        offThread()
      }
    },
    prefill(text) {
      if (typeof text !== 'string' || !text) return
      show?.()
      // The chat page fills its composer; ./register keeps it while the page loads.
      window.dispatchEvent(new CustomEvent(PREFILL_EVENT, { detail: { text } }))
    },
    async send(text, opts = {}) {
      if (typeof text !== 'string' || !text.trim()) return
      let sid = activeId()
      if (sid && threadStore.get(sid).isRunning) return // the composer is disabled while a reply runs
      const created = !sid
      // A new chat gets a client-minted id, as the chat page's own composer does.
      if (!sid) sid = newSessionId()
      const sent = threadStore.send(transport(), sid, text, { agentName: opts.agentName })
      if (created) sessionsStore.noteCreated(sid)
      show?.()
      await sent
    },
    async cancel() {
      const sid = activeId()
      if (sid && threadStore.get(sid).isRunning) await threadStore.cancel(transport(), sid)
    },
    async resolveApproval(approvalId, approved, opts = {}) {
      const sid = activeId()
      if (!sid || !threadStore.findApproval(sid, approvalId)) throw new Error('This approval is not in the open chat')
      await threadStore.respondApproval(transport(), sid, approvalId, {
        approved,
        text: opts.text,
        optionId: opts.optionId,
        always: opts.always === true,
      })
    },
  }
}
