/**
 * The top bar's second line on the chat page: "Researcher · 3 artifacts ·
 * edited 2 min ago" (agent of the newest answer, distinct artifacts of the
 * open chat, their newest change). While the chat's socket is not open a
 * pulsing dot and "reconnecting" join it (a drop also shows a banner above
 * the composer); the open state is the sidebar foot's "Connected" line.
 * Nothing while none of it is known. Mounted only on the chat page, so the
 * chat and artifacts feeds load there. It also reports the open chat's
 * artifact count (`onCount`) for its sidebar row.
 */
import { useEffect } from 'react'
import { useChat, useSessionArtifacts } from './data'
import { chatSubtitle, connectionWord, lastAgent, summarizeArtifacts } from './format'

export function ChatLine({ sessionId, running, now, onCount }: {
  sessionId: string | null
  running: boolean
  now?: number
  /** The open chat's artifact count, as it changes (the sidebar's row). */
  onCount?(sessionId: string, count: number): void
}) {
  const chat = useChat()
  const artifacts = summarizeArtifacts(useSessionArtifacts(sessionId))
  useEffect(() => {
    if (sessionId) onCount?.(sessionId, artifacts.count)
  }, [sessionId, artifacts.count, onCount])
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
          <span aria-hidden="true" className="size-2 rounded-full bg-warning motion-safe:animate-pulse" />
          {conn.word}
        </span>
      )}
      {rest && (agent || conn) && <span aria-hidden="true">·</span>}
      {rest && <span className="truncate">{rest}</span>}
    </p>
  )
}
