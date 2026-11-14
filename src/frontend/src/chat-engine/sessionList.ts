/**
 * The chat rail's session list: the server's list plus chats started on this
 * page that the server has not listed yet. Pure, so it runs under node --test.
 *
 * A chat created here is kept as a local entry. It does two jobs:
 *   1. Until the server lists the chat, it is shown as a row of its own.
 *   2. While the server lists the chat without a title, it supplies the title
 *      (the first user message).
 * Once the server has listed an entry it is marked `listed` and is never shown
 * as a row of its own again, so a chat the server stops listing (deleted here
 * or elsewhere) cannot come back from the local map.
 */
import type { ChatSession } from './api'

export interface LocalSession {
  title: string
  /** The server has listed this chat at least once. */
  listed?: boolean
  createdAt: number
}

export type LocalSessions = Readonly<Record<string, LocalSession>>

/** A chat that was just started on this page. */
export function addLocalSession(local: LocalSessions, id: string, title: string, now = Date.now()): LocalSessions {
  const prev = local[id]
  if (prev && prev.title === title) return local
  return { ...local, [id]: { title, listed: prev?.listed, createdAt: prev?.createdAt ?? now } }
}

/** A rename: a local entry takes the new title too (the server may not list the chat yet). */
export function renameLocalSession(local: LocalSessions, id: string, title: string): LocalSessions {
  const prev = local[id]
  if (!prev || prev.title === title) return local
  return { ...local, [id]: { ...prev, title } }
}

/** A delete: forget the local entry. */
export function removeLocalSession(local: LocalSessions, id: string): LocalSessions {
  if (!(id in local)) return local
  const next = { ...local }
  delete next[id]
  return next
}

/** After a server refresh: entries the server listed are marked, so they are never shown on their own again. */
export function markListed(local: LocalSessions, server: readonly ChatSession[]): LocalSessions {
  const ids = new Set(server.map((s) => s.id))
  let next: Record<string, LocalSession> | null = null
  for (const [id, entry] of Object.entries(local)) {
    if (entry.listed || !ids.has(id)) continue
    next ??= { ...local }
    next[id] = { ...entry, listed: true }
  }
  return next ?? local
}

/** The rows the rail shows: unlisted local chats (newest first), then the server's list. */
export function mergeSessions(server: readonly ChatSession[], local: LocalSessions): ChatSession[] {
  const byId = new Set(server.map((s) => s.id))
  const pending: ChatSession[] = Object.entries(local)
    .filter(([id, entry]) => !entry.listed && !byId.has(id))
    .sort(([, a], [, b]) => b.createdAt - a.createdAt)
    .map(([id, entry]) => ({ id, title: entry.title, untitled: false, updatedAt: entry.createdAt }))
  const listed = server.map((s) => (s.untitled && local[s.id] ? { ...s, title: local[s.id].title } : s))
  return [...pending, ...listed]
}
