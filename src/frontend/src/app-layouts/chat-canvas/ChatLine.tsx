/**
 * The top bar's second line on the chat page: "Researcher · connected ·
 * 3 artifacts · edited 2 min ago" (agent of the newest answer, an 8px dot
 * and the live connection, distinct artifacts of the open chat, their newest
 * change). The connection lives here, as chrome, not in the thread; a drop
 * also shows a banner above the composer. Nothing while none of it is known.
 * Mounted only on the chat page, so the chat and artifacts feeds load there.
 */
import { cn } from '@/lib/utils'
import { useChat, useSessionArtifacts } from './data'
import { chatSubtitle, connectionWord, lastAgent, summarizeArtifacts } from './format'

export function ChatLine({ sessionId, running, now }: { sessionId: string | null; running: boolean; now?: number }) {
  const chat = useChat()
  const artifacts = summarizeArtifacts(useSessionArtifacts(sessionId))
  const agent = chat?.sessionId === sessionId ? lastAgent(chat?.messages) : undefined
  const conn = connectionWord(chat?.connection)
  const rest = chatSubtitle({ running, artifacts: artifacts.count, editedAt: artifacts.updatedAt }, now)
  if (!agent && !conn && !rest) return null
  return (
    <p className="m-0 flex min-w-0 items-center gap-1.5 truncate text-[13px] text-muted-foreground" data-cc-subtitle="">
      {agent && <span className="truncate">{agent}</span>}
      {agent && conn && <span aria-hidden="true">·</span>}
      {conn && (
        <span className="inline-flex shrink-0 items-center gap-1.5" data-cc-connection={chat?.connection}>
          <span aria-hidden="true" className={cn('size-2 rounded-full', conn.tone === 'ok' ? 'bg-success' : 'bg-warning motion-safe:animate-pulse')} />
          {conn.word}
        </span>
      )}
      {rest && (agent || conn) && <span aria-hidden="true">·</span>}
      {rest && <span className="truncate">{rest}</span>}
    </p>
  )
}
