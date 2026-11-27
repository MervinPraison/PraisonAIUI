/**
 * Embedded `chat_panel` block: mounts `ChatPage` in compact `embedded` mode
 * inside any `@aiui.page` layout (e.g. split-pane `columns([doc_viewer, chat_panel])`).
 *
 * Imports `ChatPage` lazily so Rollup keeps the entire chat runtime inside the
 * single `ChatPage` chunk (zero chunk-split overhead on `/chat`, R10). Registered
 * by `builtin/chat.ts` via `@aiui/sdk` so `blocks/` never imports `chat-engine/` (R1).
 */
import { lazy, Suspense, useMemo, type JSX } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import type { ShellPage } from '@/sdk/manifest'
import type { BlockNode } from '@/sdk/registry'
import type { AiuiTransport } from './transports'

const ChatPageLazy = lazy(() => import('./ChatPage'))

function panelHeightStyle(raw: unknown): string {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 200) return `${Math.round(raw)}px`
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return '520px'
}

export interface ChatPanelBlockProps {
  node: BlockNode
  transport?: AiuiTransport
}

export default function ChatPanelBlock({ node, transport }: ChatPanelBlockProps): JSX.Element {
  const p = node.props ?? {}
  const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim() : 'Agent Chat'
  const agent = typeof p.agent === 'string' && p.agent.trim() ? p.agent.trim() : undefined
  const sessionId = typeof p.session_id === 'string' && p.session_id.trim() ? p.session_id.trim() : null
  const welcome = typeof p.welcome === 'string' && p.welcome.trim() ? p.welcome.trim() : undefined
  const height = panelHeightStyle(p.height)

  const page = useMemo<ShellPage>(
    () => ({ id: 'chat-panel', title, kind: 'native', icon: 'message-square', group: 'Workspace', order: 0 }),
    [title],
  )
  const embedded = useMemo(() => ({ agent, sessionId, welcome }), [agent, sessionId, welcome])

  return (
    <div
      data-aiui-chat-panel=""
      style={{ height }}
      className="flex min-h-[200px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-foreground"
    >
      <Suspense fallback={<Skeleton className="h-full w-full" />}>
        <ChatPageLazy page={page} transport={transport} embedded={embedded} />
      </Suspense>
    </div>
  )
}
