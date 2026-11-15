/**
 * The Quiet Workbench's view model: pure functions over LayoutProps and the
 * layout feeds, so the frame stays a thin render (workbench.test.tsx).
 */
import type { LayoutProps } from '@/sdk/layouts'
import type { ApprovalItem, ChatState, SessionsState } from '@/sdk/layoutTypes'

/** Keyboard shortcuts the frame owns (⌘K is the shell's palette). */
export const SHORTCUTS = Object.freeze({ newChat: 'mod+n', toggleSidebar: 'mod+b' })

/** localStorage: '1' while the viewer keeps the desktop sidebar collapsed. */
export const SIDEBAR_COLLAPSED_KEY = 'aiui-workbench-sidebar-collapsed'

/** The page the chat list and New chat open: this layout's `home` (the server's LayoutSpec), else `chat`. */
export function chatPageOf(layout: Pick<LayoutProps['layout'], 'id' | 'available'>): string {
  return layout.available.find((s) => s.id === layout.id)?.home || 'chat'
}

export interface TitleInput {
  pageId: string
  page?: { title?: string }
  chatPage: string
  sessions: SessionsState | null
  siteTitle: string
}

/** The top bar's title: the open chat's on the chat page, else the page's own. */
export function frameTitle({ pageId, page, chatPage, sessions, siteTitle }: TitleInput): string {
  if (pageId === chatPage && sessions) {
    const id = sessions.activeId
    if (!id) return 'New chat'
    return sessions.sessions.find((s) => s.id === id)?.title || page?.title || 'Chat'
  }
  return page?.title || siteTitle
}

/** Who answers in the open chat: the last reply's agent, else the session's. */
export function agentOf(chat: ChatState | null, sessions: SessionsState | null): string | undefined {
  const messages = chat?.messages ?? []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && m.agentName) return m.agentName
  }
  const id = sessions?.activeId
  return (id && sessions?.sessions.find((s) => s.id === id)?.agent) || undefined
}

/** Sessions with an approval waiting (the session list labels them). */
export function waitingSessionIds(pending: readonly ApprovalItem[]): ReadonlySet<string> {
  return new Set(pending.map((p) => p.sessionId).filter((id): id is string => !!id))
}

/** `{name → model}` from GET /api/agents/definitions (`{agents: [...]}` or a bare list). */
export function modelsByAgent(data: unknown): Map<string, string> {
  const raw = Array.isArray(data) ? data : (data as { agents?: unknown } | null)?.agents
  const out = new Map<string, string>()
  if (!Array.isArray(raw)) return out
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue
    const rec = a as Record<string, unknown>
    const model = typeof rec.model === 'string' ? rec.model.trim() : ''
    if (!model) continue
    for (const key of [rec.name, rec.id, rec.agent_id]) {
      if (typeof key === 'string' && key.trim()) out.set(key.trim().toLowerCase(), model)
    }
  }
  return out
}

export function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function writeCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, '1')
    else window.localStorage.removeItem(SIDEBAR_COLLAPSED_KEY)
  } catch {
    /* storage blocked: the choice lasts for this page view */
  }
}
