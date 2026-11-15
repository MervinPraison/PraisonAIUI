/**
 * The top bar's second line on the chat page: "Researcher · 3 artifacts ·
 * edited 2 min ago" (agent of the newest answer, distinct artifacts of the
 * open chat, their newest change). Nothing while none of it is known.
 * Mounted only on the chat page, so the chat and artifacts feeds load there.
 */
import { useChat, useSessionArtifacts } from './data'
import { chatSubtitle, lastAgent, summarizeArtifacts } from './format'

export function ChatLine({ sessionId, running, now }: { sessionId: string | null; running: boolean; now?: number }) {
  const chat = useChat()
  const artifacts = summarizeArtifacts(useSessionArtifacts(sessionId))
  const text = chatSubtitle(
    {
      agent: chat?.sessionId === sessionId ? lastAgent(chat?.messages) : undefined,
      running,
      artifacts: artifacts.count,
      editedAt: artifacts.updatedAt,
    },
    now,
  )
  if (!text) return null
  return (
    <p className="m-0 truncate text-[13px] text-muted-foreground" data-cc-subtitle="">
      {text}
    </p>
  )
}
