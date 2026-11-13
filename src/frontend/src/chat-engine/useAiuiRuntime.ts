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
import { threadStore, type SessionThread } from './store'
import { createSseTransport, type AiuiTransport } from './transports'
import type { AiuiMessage } from './protocol'

export interface AiuiStarter { title?: string; label?: string; prompt: string }

export interface UseAiuiRuntimeOptions {
  /** Controlled session id. `null` = new chat; the id is minted client-side on first send. */
  sessionId: string | null
  onSessionCreated?: (sessionId: string) => void
  transport?: AiuiTransport
  agentName?: string
  starters?: AiuiStarter[]
  historyUrl?: (sid: string) => string
  /** Session list for the threadList adapter (the host owns fetching). */
  sessions?: { id: string; title?: string }[]
  onSelectSession?: (id: string | null) => void
  onRenameSession?: (id: string, title: string) => Promise<void> | void
  onDeleteSession?: (id: string) => Promise<void> | void
  /** User-facing problems the runtime would otherwise swallow (e.g. an attachment over 10 MB). */
  onError?: (message: string) => void
  /** A message is being sent: an earlier onError notice no longer applies. */
  onSend?: () => void
}

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

  const sendText = useCallback(async (text: string, attachments?: AiuiMessage['attachments']) => {
    optsRef.current.onSend?.()
    const p = threadStore.send(transport, sid, text, {
      agentName: optsRef.current.agentName,
      attachmentIds: attachments?.map((a) => a.id),
      attachments,
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
          if (!res.ok) threadStore.setFeedback(sid, message.id, undefined)
        })
        .catch(() => threadStore.setFeedback(sid, message.id, undefined))
    },
  }), [sid])

  const runtime = useExternalStoreRuntime<AiuiMessage>({
    messages: thread.messages,
    isRunning: thread.isRunning,
    isLoading: thread.isLoading,
    activeRunId: thread.activeRunId,
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
    onReload: async () => {
      // The server has no regenerate; resend the last user turn (server history is append-only).
      const turn = threadStore.popLastTurn(sid)
      if (turn) await sendText(turn.text, turn.attachments)
    },
    // The gate stays open until the server accepts; a rejection is kept on the part (see the store).
    onRespondToToolApproval: ({ approvalId, approved, optionId, text }) =>
      threadStore.respondApproval(transport, sid, approvalId, { approved, optionId, text }),
    adapters: {
      attachments,
      feedback,
      threadList: {
        threadId: opts.sessionId ?? undefined,
        threads: opts.sessions?.map((s) => ({ status: 'regular' as const, id: s.id, title: s.title })),
        onSwitchToThread: (id) => optsRef.current.onSelectSession?.(id),
        onSwitchToNewThread: () => optsRef.current.onSelectSession?.(null),
        onRename: (id, title) => {
          void optsRef.current.onRenameSession?.(id, title)
        },
        onDelete: (id) => optsRef.current.onDeleteSession?.(id),
      },
    },
  })

  /** Put text into the composer (aiui:prefill-composer). */
  const setComposerText = useCallback((text: string) => {
    runtime.thread.composer.setText(text)
  }, [runtime])

  return { runtime, thread, sessionId: sid, transport, setComposerText }
}
