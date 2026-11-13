/**
 * AiuiMessage -> assistant-ui ThreadMessageLike. Pure (type-only import of
 * assistant-ui), so it runs under node --test.
 */
import type { ThreadMessageLike } from '@assistant-ui/react'
import type { AiuiMessage } from './protocol'

/** Empty, still-running reasoning has no text yet; core drops blank parts, so keep a placeholder. */
const ZWSP = '\u200b'

/** AiuiMessage -> assistant-ui ThreadMessageLike (pure). */
export function convertMessage(m: AiuiMessage): ThreadMessageLike {
  if (m.role === 'system') {
    return { id: m.id, role: 'system', content: [{ type: 'text', text: m.parts.map((p) => ('text' in p ? p.text : '')).join('') }] }
  }
  const content = m.parts.map((p) => {
    switch (p.type) {
      case 'text':
        return { type: 'text' as const, id: p.id, text: p.text }
      case 'reasoning':
        return { type: 'reasoning' as const, id: p.id, text: p.text || (p.done ? '' : ZWSP), timing: p.timing }
      case 'tool-call':
        return {
          type: 'tool-call' as const,
          toolCallId: p.id,
          toolName: p.toolName,
          args: p.args as never,
          result: p.result,
          isError: p.isError,
          artifact: p.artifact,
          approval: p.approval,
          timing: p.timing,
        }
      // Never the `image` part: core drops non-https/blob/data URLs (thread-message-like.js).
      case 'data':
        return { type: `data-${p.name}` as const, id: p.id, data: p.data }
    }
  })
  return {
    id: m.id,
    role: m.role,
    createdAt: new Date(m.createdAt),
    content: m.role === 'user' ? content.filter((c) => c.type === 'text') : content,
    status: m.role === 'assistant' ? toStatus(m.status) : undefined,
    attachments: m.role === 'user'
      ? m.attachments?.map((a) => ({
          id: a.id, name: a.name, contentType: a.contentType, status: { type: 'complete' as const },
          type: a.contentType.startsWith('image/') ? ('image' as const) : ('document' as const),
          content: a.previewUrl ? [{ type: 'image' as const, image: a.previewUrl }] : [],
        }))
      : undefined,
    metadata: {
      runId: m.runId,
      submittedFeedback: m.custom?.feedback ? { type: m.custom.feedback as 'positive' | 'negative' } : undefined,
      custom: { ...m.custom, agentName: m.agentName },
    },
  }
}

function toStatus(s: AiuiMessage['status']): ThreadMessageLike['status'] {
  if (!s) return undefined
  if (s.type === 'complete') return { type: 'complete', reason: 'stop' }
  if (s.type === 'incomplete') return { type: 'incomplete', reason: s.reason, error: s.error }
  return s
}
