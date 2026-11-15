/**
 * The feeds the Command Deck frame reads (chat, approvals) as React hooks,
 * and the pending approvals merged from both: the approvals feed (every
 * session) and open gates of the open chat (an older server's runs, or the
 * approvals built-in switched off). Each hook returns an empty state while
 * its provider is off, so the frame renders without it.
 */
import { useMemo, useSyncExternalStore } from 'react'
import { useLayoutData } from '@/sdk/layouts'
import type { ApprovalItem, ApprovalsFeed, ApprovalsState, ChatFeed, ChatMessageView, ChatState } from '@/sdk/layoutTypes'
import { fetchJson } from '@/sdk/services'
import type { ShellManifest } from '@/sdk/manifest'

const EMPTY_CHAT: ChatState = Object.freeze({ sessionId: null, messages: [], isRunning: false })
const EMPTY_APPROVALS: ApprovalsState = Object.freeze({ pending: [] })
const noSubscribe = () => () => {}

export function useChat(): { feed: ChatFeed | null; state: ChatState } {
  const feed = useLayoutData('chat')
  const read = feed ? feed.get : () => EMPTY_CHAT
  return { feed, state: useSyncExternalStore(feed ? feed.subscribe : noSubscribe, read, read) }
}

export function useApprovals(): { feed: ApprovalsFeed | null; state: ApprovalsState } {
  const feed = useLayoutData('approvals')
  const read = feed ? feed.get : () => EMPTY_APPROVALS
  return { feed, state: useSyncExternalStore(feed ? feed.subscribe : noSubscribe, read, read) }
}

/** Open gates of the open chat as approval items (newest last). */
export function chatGates(messages: readonly ChatMessageView[], sessionId: string | null): ApprovalItem[] {
  const out: ApprovalItem[] = []
  for (const m of messages) {
    if (m.role !== 'assistant' || m.status?.type === 'incomplete') continue
    for (const p of m.parts) {
      if (p.type !== 'tool-call' || !p.approval || p.approval.approved !== undefined) continue
      out.push({
        id: p.approval.id,
        toolName: p.toolName,
        agentName: m.agentName,
        sessionId: sessionId ?? undefined,
        riskLevel: typeof p.artifact.risk_level === 'string' ? p.artifact.risk_level : undefined,
        description: typeof p.artifact.description === 'string' ? p.artifact.description : p.approval.prompt,
        args: p.args,
      })
    }
  }
  return out
}

/** Every pending approval: the feed's, then the open chat's that the feed does not list. */
export function mergePending(feed: readonly ApprovalItem[], gates: readonly ApprovalItem[]): ApprovalItem[] {
  const ids = new Set(feed.map((a) => a.id))
  return [...feed, ...gates.filter((g) => !ids.has(g.id))]
}

export function usePending(chat: ChatState, approvals: ApprovalsState): ApprovalItem[] {
  return useMemo(() => mergePending(approvals.pending, chatGates(chat.messages, chat.sessionId)), [approvals.pending, chat.messages, chat.sessionId])
}

/** The agent of the open chat's latest answer. */
export function latestAgent(messages: readonly ChatMessageView[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant' && messages[i].agentName) return messages[i].agentName
  return undefined
}

// ── the run ledger (status bar: today's tokens and cost) ─────────────

export function hasRunLedger(manifest: Pick<ShellManifest, 'plugins'> | null | undefined): boolean {
  return !!manifest?.plugins?.some((p) => p.name === 'builtin.run-ledger' && p.status === 'ok')
}

/** The ledger's recent runs (`GET /api/runs`), newest first; [] when it is off or fails. */
export async function fetchRecentRuns(limit = 200): Promise<{ startedAt: number; tokens?: number; cost?: number }[]> {
  try {
    const data = await fetchJson<{ runs?: unknown }>(`/api/runs?limit=${limit}`)
    const runs = Array.isArray(data?.runs) ? data.runs : []
    return runs
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && typeof (r as Record<string, unknown>).startedAt === 'number')
      .map((r) => ({
        startedAt: r.startedAt as number,
        tokens: typeof r.tokens === 'number' ? r.tokens : undefined,
        cost: typeof r.cost === 'number' ? r.cost : undefined,
      }))
  } catch {
    return []
  }
}
