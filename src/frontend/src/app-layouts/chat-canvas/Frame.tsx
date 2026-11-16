/**
 * The Chat and Canvas layout frame (chunk `layout-chat-canvas`): the app
 * shell's default layout, and the `chat` layout (`aiui run`'s default),
 * which is this frame with no canvas. Design: Canvas.dc.html (desktop) and
 * CanvasPhone.dc.html (phone), drawn with the PraisonAI Pro tokens.
 *
 *   desktop  sidebar (brand, New chat ⌘N, primary pages, chats, footer
 *            pages, More ⌘K), collapsible with ⌘B; a top bar with the
 *            chat's title and "agent · n artifacts · edited …", search,
 *            Share and the theme; the routed page
 *   tablet   the same; the chat page starts with its canvas closed
 *   phone    a header (menu, title, New chat); the menu opens a sheet with
 *            the sidebar; the chat page's own "Chat | Canvas (n)" switch
 *
 * The chat page itself draws the thread, the canvas aside and the artifact
 * cards (meta.chat in builtin/layouts/chat-canvas.ts); this frame provides
 * the `artifacts` feed while it is on screen and styles what the page shows
 * inside it (./chat-canvas.css).
 *
 * A layout imports only the SDK, components/ui, lib, the kit and the light
 * chat-engine modules, never another layout or the shell, and features only
 * with import() (app-layouts/isolation.test.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PhoneSheet, useSessions } from '@/app-layouts/kit'
import type { LayoutProps } from '@/sdk/layouts'
import { cn } from '@/lib/utils'
import { ChatLine } from './ChatLine'
import { useArtifactTotal, useProvideArtifacts } from './data'
import { frameKeyAction, optionVars } from './frameLogic'
import { ARTIFACTS_PAGE, Brand, SidebarBody } from './Sidebar'
import { PhoneTopBar, TopBar, type TitleLine } from './TopBar'
import { useStoredFlag } from './useStoredFlag'
import './chat-canvas.css'

/**
 * Layouts this frame draws without a canvas (builtin/layouts/chat.ts): no
 * artifacts feed, so the artifacts feature chunk never loads.
 */
const NO_CANVAS_LAYOUTS: ReadonlySet<string> = new Set(['chat'])

/** The page New chat and the chat rows open when the layout spec names no home. */
const DEFAULT_CHAT_PAGE = 'chat'
const SIDEBAR_KEY = 'aiui-chat-canvas-sidebar-hidden'

/**
 * The top bar's title and line: the open chat and its ChatLine on the chat
 * page, else the page's title. The line is a component of its own so the
 * chat and artifacts feeds (and the artifacts chunk) load only on the chat page.
 */
function useTitleLine(onChat: boolean, pageTitle: string): TitleLine {
  const sessions = useSessions()
  if (!onChat) return { title: pageTitle }
  const activeId = sessions?.state.activeId ?? null
  const current = activeId ? sessions?.state.sessions.find((s) => s.id === activeId) : undefined
  return {
    title: current?.title ?? (activeId ? 'Chat' : 'New chat'),
    subtitle: <ChatLine sessionId={activeId} running={!!activeId && !!sessions?.state.runningIds.has(activeId)} />,
  }
}

export default function ChatCanvasFrame(props: LayoutProps) {
  const { Outlet, nav, chrome, viewport, page, pageId, fullBleed, layout } = props
  const phone = viewport === 'phone'
  const spec = layout.available.find((s) => s.id === layout.id)
  const chatPage = spec?.home ?? DEFAULT_CHAT_PAGE
  const onChat = pageId === chatPage || page?.id === chatPage
  const sessions = useSessions()
  const [hidden, setHidden] = useStoredFlag(SIDEBAR_KEY)
  const [menuOpen, setMenuOpen] = useState(false)
  useProvideArtifacts(NO_CANVAS_LAYOUTS.has(layout.id) ? null : undefined)

  const hasArtifactsPage = nav.primary.some((i) => i.id === ARTIFACTS_PAGE) || nav.groups.some((g) => g.items.some((i) => i.id === ARTIFACTS_PAGE))
  // A finished run may have made artifacts: the running set changing refreshes the count.
  const runningKey = sessions ? [...sessions.state.runningIds].sort().join(',') : ''
  const artifactTotal = useArtifactTotal(hasArtifactsPage, runningKey)
  const line = useTitleLine(onChat, page?.title ?? chrome.siteTitle)

  const newChat = useCallback(() => {
    if (!sessions) return
    sessions.feed.create()
    if (nav.activeId !== chatPage) nav.go(chatPage)
  }, [sessions, nav, chatPage])
  const toggleSidebar = useCallback(() => setHidden((h) => !h), [setHidden])
  const actions = useRef({ newChat, toggleSidebar })
  useEffect(() => {
    actions.current = { newChat, toggleSidebar }
  })
  const canCreate = !!sessions
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const action = frameKeyAction(e, { phone, canCreate })
      if (!action) return
      e.preventDefault()
      if (action === 'new-chat') actions.current.newChat()
      else actions.current.toggleSidebar()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phone, canCreate])
  const style = useMemo(() => optionVars(spec?.options), [spec?.options])

  const collapsed = !phone && hidden
  return (
    <div
      data-aiui-layout-frame="chat-canvas"
      data-viewport={viewport}
      data-chat-page={onChat || undefined}
      className="flex min-h-0 min-w-0 flex-1 bg-background text-foreground"
      style={style}
    >
      {!phone && !collapsed && (
        <nav
          aria-label="Main"
          className="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-sidebar-border bg-sidebar px-3 py-3.5 text-sidebar-foreground"
        >
          <SidebarBody
            nav={nav}
            chrome={chrome}
            size="default"
            chatPage={chatPage}
            artifactTotal={artifactTotal}
            onCollapse={toggleSidebar}
          />
        </nav>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {phone ? (
          <PhoneTopBar line={line} canCreate={canCreate} onMenu={() => setMenuOpen(true)} onNewChat={newChat} />
        ) : (
          <TopBar line={line} chrome={chrome} collapsed={collapsed} onExpand={toggleSidebar} share={onChat && !!sessions?.state.activeId} />
        )}
        <main
          id={chrome.mainId}
          tabIndex={-1}
          className={cn('min-h-0 min-w-0 flex-1 outline-none', fullBleed ? 'flex flex-col overflow-hidden' : 'overflow-y-auto')}
        >
          <Outlet />
        </main>
      </div>
      {phone && (
        <PhoneSheet open={menuOpen} onOpenChange={setMenuOpen} title="Menu and chats" header={<Brand chrome={chrome} size="touch" />}>
          <SidebarBody
            nav={nav}
            chrome={chrome}
            size="touch"
            chatPage={chatPage}
            artifactTotal={artifactTotal}
            onNavigate={() => setMenuOpen(false)}
          />
        </PhoneSheet>
      )}
    </div>
  )
}
