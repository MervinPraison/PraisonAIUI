/**
 * useAiuiRuntime — assistant-ui ExternalStoreRuntime over the AIUI stream protocol.
 *
 *   const { runtime, thread } = useAiuiRuntime({ sessionId, onSessionCreated, transport })
 *   <AssistantRuntimeProvider runtime={runtime}><Thread /></AssistantRuntimeProvider>
 *
 * This is the ONLY module that touches the assistant-ui runtime API; the rest
 * of the shell talks to the store and the transports.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  useExternalStoreRuntime,
  type AppendMessage,
  type AttachmentAdapter,
  type CompleteAttachment,
  type FeedbackAdapter,
  type PendingAttachment,
} from '@assistant-ui/react'
import { convertMessage } from './convert'
import { isLastReply } from './util'
import { threadStore, type SessionThread } from './store'
import { canRegenerate, createSseTransport, type AiuiTransport } from './transports'
import type { AiuiMessage } from './protocol'

export interface AiuiStarter {
  title?: string
  label?: string
  prompt: string
  /** The prompt is a template to finish: a click puts it in the composer instead of sending it. */
  fill?: boolean
}

export interface UseAiuiRuntimeOptions {
  /** Controlled session id. `null` = new chat; the id is minted client-side on first send. */
  sessionId: string | null
  onSessionCreated?: (sessionId: string) => void
  transport?: AiuiTransport
  agentName?: string
  starters?: AiuiStarter[]
  historyUrl?: (sid: string) => string
  /** User-facing problems the runtime would otherwise swallow (e.g. an attachment over 10 MB). */
  onError?: (message: string) => void
  /** A message is being sent: an earlier onError notice no longer applies. */
  onSend?: () => void
  /**
   * Offer thumbs up/down (default true). false hides them: the server has
   * feedback switched off (manifest `site.feedbackEnabled: false`).
   */
  feedback?: boolean
}

/** The server answered a feedback post with 403 (set_feedback_enabled(False)): stop offering it. */
let feedbackRefused = false
const refusalFns = new Set<() => void>()
function refuseFeedback() {
  if (feedbackRefused) return
  feedbackRefused = true
  for (const fn of [...refusalFns]) fn()
}
function subscribeRefusal(fn: () => void) {
  refusalFns.add(fn)
  return () => {
    refusalFns.delete(fn)
  }
}
const getRefused = () => feedbackRefused

export { convertMessage }

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024 // same limit as views/chat.js
const ACCEPT = 'image/*,application/pdf,.txt,.md,.csv,.json'

export const newSessionId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
}

export function useAiuiRuntime(opts: UseAiuiRuntimeOptions) {
  const [fallbackTransport] = useState(() => createSseTransport())
  const transport = opts.transport ?? fallbackTransport
  // A new chat gets a client-minted id immediately (both /run and the WS accept it).
  const [draftId, setDraftId] = useState(newSessionId)
  const sid = opts.sessionId ?? draftId
  const isDraft = !opts.sessionId

  // Callbacks read the latest options without re-creating the runtime adapters.
  const optsRef = useRef(opts)
  useEffect(() => {
    optsRef.current = opts
  })

  const thread: SessionThread = useSyncExternalStore(
    useCallback((fn: () => void) => threadStore.subscribe(sid, fn), [sid]),
    () => threadStore.get(sid),
  )

  useEffect(() => {
    if (opts.historyUrl) threadStore.configure({ historyUrl: opts.historyUrl })
  }, [opts.historyUrl])

  useEffect(() => {
    if (opts.sessionId) void threadStore.load(opts.sessionId)
  }, [opts.sessionId])

  // Follow runs other tabs start in this session (read-only live message).
  useEffect(() => {
    if (!opts.sessionId) return
    return threadStore.observe(transport, opts.sessionId)
  }, [transport, opts.sessionId])

  // Live-connection state -> thread.signals.connection; keep the socket up while mounted.
  useEffect(() => {
    threadStore.setConnection(transport.status)
    const offStatus = transport.onStatus?.((s) => threadStore.setConnection(s))
    const release = transport.retain?.()
    return () => {
      offStatus?.()
      release?.()
    }
  }, [transport])

  const sendText = useCallback(async (text: string, attachments?: AiuiMessage['attachments'], regenerate?: { replacedText?: string }) => {
    optsRef.current.onSend?.()
    const p = threadStore.send(transport, sid, text, {
      agentName: optsRef.current.agentName,
      attachmentIds: attachments?.map((a) => a.id),
      attachments,
      regenerate: !!regenerate,
      replacedText: regenerate?.replacedText,
    })
    if (isDraft) {
      optsRef.current.onSessionCreated?.(sid)
      setDraftId(newSessionId())
    }
    await p
  }, [transport, sid, isDraft])

  const attachments: AttachmentAdapter = useMemo(() => ({
    accept: ACCEPT,
    async add({ file }): Promise<PendingAttachment> {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        const msg = `${file.name} is larger than 10 MB and was not attached.`
        optsRef.current.onError?.(msg)
        throw new Error(msg)
      }
      return {
        id: newSessionId(), file, name: file.name, contentType: file.type,
        type: file.type.startsWith('image/') ? 'image' : 'document',
        status: { type: 'requires-action', reason: 'composer-send' },
      }
    },
    async remove() {
      /* nothing is uploaded before send */
    },
    async send(a: PendingAttachment): Promise<CompleteAttachment> {
      const fd = new FormData()
      fd.append('file', a.file)
      fd.append('session_id', sid)
      const res = await fetch('/api/chat/attachments', { method: 'POST', body: fd, credentials: 'same-origin' })
      if (!res.ok) {
        const msg = `Upload of ${a.name} failed (HTTP ${res.status}).`
        optsRef.current.onError?.(msg)
        throw new Error(msg)
      }
      const data = (await res.json()) as { attachment_id?: string; id?: string }
      const serverId = data.attachment_id ?? data.id ?? a.id
      return {
        ...a,
        status: { type: 'complete' },
        // No object-URL preview: the thread shows attachments by name, and an
        // unrevoked blob URL would pin the file in memory for the page's lifetime.
        content: [{ type: 'data', name: 'aiui-attachment', data: { id: serverId } }],
      }
    },
  }), [sid])

  const feedback: FeedbackAdapter = useMemo(() => ({
    submit({ message, type }) {
      threadStore.setFeedback(sid, message.id, type)
      void postJson('/api/feedback', { session_id: sid, message_id: message.id, value: type === 'positive' ? 1 : -1 })
        .then((res) => {
          if (res.ok) return
          threadStore.setFeedback(sid, message.id, undefined)
          // Feedback is switched off on the server: hide the buttons rather than flip and revert.
          if (res.status === 403) refuseFeedback()
        })
        .catch(() => threadStore.setFeedback(sid, message.id, undefined))
    },
  }), [sid])

  const refused = useSyncExternalStore(subscribeRefusal, getRefused, getRefused)
  const offerFeedback = opts.feedback !== false && !refused

  const runtime = useExternalStoreRuntime<AiuiMessage>({
    messages: thread.messages,
    isRunning: thread.isRunning,
    isLoading: thread.isLoading,
    activeRunId: thread.activeRunId,
    // Paging back through history: the runtime serialises presses and
    // exposes thread.isLoadingEarlier; ThreadPrimitive.LoadEarlier keeps
    // focus on the button while a page loads.
    hasEarlier: Boolean(thread.hasMore) && !thread.isLoading,
    onLoadEarlier: () => threadStore.loadEarlier(sid),
    convertMessage,
    suggestions: opts.starters?.map((s) => ({ title: s.title, label: s.label, prompt: s.prompt })),
    onNew: async (msg: AppendMessage) => {
      const text = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
      const atts = msg.attachments?.map((a) => {
        const d = a.content?.find((c) => c.type === 'data' && c.name === 'aiui-attachment')
        return {
          id: d && d.type === 'data' ? (d.data as { id: string }).id : a.id,
          name: a.name,
          contentType: a.contentType ?? '',
        }
      })
      await sendText(text, atts?.length ? atts : undefined)
    },
    onCancel: () => threadStore.cancel(transport, sid),
    // No onReload (the Regenerate button is hidden) when the transport cannot
    // regenerate server-side: on SSE a regenerate is a plain resend and the
    // turn would appear twice after a reload. Re-read on every render, so it
    // follows the socket state and the transport that carried the last turn.
    onReload: !canRegenerate(transport, sid) ? undefined : async (parentId) => {
      // Only the last answer can be regenerated: the server answers its last
      // question again. A reload aimed at an earlier answer is ignored rather
      // than turned into a regenerate of the last turn.
      if (!isLastReply(threadStore.get(sid).messages, parentId)) return
      // The server answers the last question again and the new answer
      // replaces the old one in history (no duplicate turn after a reload).
      const turn = threadStore.popLastTurn(sid)
      if (turn) await sendText(turn.text, turn.attachments, { replacedText: turn.replacedText })
    },
    // The gate stays open until the server accepts; a rejection is kept on the part (see the store).
    onRespondToToolApproval: ({ approvalId, approved, optionId, text }) =>
      threadStore.respondApproval(transport, sid, approvalId, { approved, optionId, text }),
    adapters: {
      attachments,
      // No adapter: thread.capabilities.feedback is false and the Thread hides the buttons.
      feedback: offerFeedback ? feedback : undefined,
      // Only the id: a change of it makes assistant-ui rebuild the thread
      // core, which is what gives each session a fresh composer. The session
      // list, rename and delete live in the SessionRail, not in assistant-ui.
      threadList: { threadId: opts.sessionId ?? undefined },
    },
  })

  /** Put text into the composer (aiui:prefill-composer). */
  const setComposerText = useCallback((text: string) => {
    runtime.thread.composer.setText(text)
  }, [runtime])

  return { runtime, thread, sessionId: sid, transport, setComposerText }
}
