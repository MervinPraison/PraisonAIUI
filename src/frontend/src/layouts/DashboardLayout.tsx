import { useCallback, useEffect, useState } from 'react'
import type { ChatConfig, LayoutConfig } from '../types'
import type { DashboardPageDef, DashboardTabGroup } from '../types/dashboard'
import { ChatArea, SessionManager } from '../chat'
import { ProfilePicker } from '../chat/ProfilePicker'
import { resolveView } from '../views'

interface DashboardLayoutProps {
    config?: ChatConfig
    layout?: LayoutConfig
    title?: string
}

/** Build sidebar tab groups from flat page list, preserving order */
function buildTabGroups(pages: DashboardPageDef[]): DashboardTabGroup[] {
    const groupMap = new Map<string, DashboardPageDef[]>()
    for (const page of pages) {
        const group = page.group || 'Other'
        if (!groupMap.has(group)) groupMap.set(group, [])
        groupMap.get(group)!.push(page)
    }
    // Sort pages within each group by order
    const groups: DashboardTabGroup[] = []
    for (const [label, groupPages] of groupMap) {
        groups.push({
            label,
            pages: groupPages.sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
        })
    }
    return groups
}

export function DashboardLayout({ config, layout: _layout, title }: DashboardLayoutProps) {
    const [activeTab, setActiveTab] = useState('chat')
    const [navCollapsed, setNavCollapsed] = useState(false)
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
    const [sessionListKey, setSessionListKey] = useState(0)
    // Protocol-driven: pages fetched from /api/pages
    const [pages, setPages] = useState<DashboardPageDef[]>([])
    const [tabGroups, setTabGroups] = useState<DashboardTabGroup[]>([])

    // Fetch registered pages from the backend protocol endpoint
    useEffect(() => {
        fetch('/api/pages')
            .then((res) => res.json())
            .then((data) => {
                const pageList: DashboardPageDef[] = data.pages || []
                // Exclude 'chat' — it's already hardcoded in the sidebar
                const filtered = pageList.filter((p) => p.id !== 'chat')
                setPages(pageList)
                setTabGroups(buildTabGroups(filtered))
            })
            .catch(() => {
                // Fallback: if /api/pages not available, show empty
                setPages([])
                setTabGroups([])
            })
    }, [])

    const handleSessionSelect = useCallback((sessionId: string) => {
        setCurrentSessionId(sessionId)
    }, [])

    const handleNewSession = useCallback(() => {
        setCurrentSessionId(null)
    }, [])

    const handleSessionChange = useCallback((sessionId: string) => {
        setCurrentSessionId(sessionId)
        setSessionListKey((k) => k + 1)
    }, [])

    const handleNavigate = useCallback((tabId: string) => {
        setActiveTab(tabId)
    }, [])

    // Find the active page definition
    const activePage = pages.find((p) => p.id === activeTab)

    const renderContent = () => {
        // Chat is always built-in (not a "page" from /api/pages)
        if (activeTab === 'chat') {
            return (
                <div className="flex flex-1 h-full">
                    {config?.features?.history !== false && (
                        <aside className="w-56 border-r flex-shrink-0 hidden md:block">
                            <SessionManager
                                key={sessionListKey}
                                currentSessionId={currentSessionId}
                                onSessionSelect={handleSessionSelect}
                                onNewSession={handleNewSession}
                                className="h-full"
                            />
                        </aside>
                    )}
                    <div className="flex-1 flex flex-col">
                        <div className="border-b px-4 py-2 flex items-center gap-2">
                            <ProfilePicker />
                        </div>
                        <ChatArea
                            config={config}
                            sessionId={currentSessionId}
                            onSessionChange={handleSessionChange}
                        />
                    </div>
                </div>
            )
        }

        // Protocol-driven: resolve view from registry or fall back to CustomPageView
        if (activePage) {
            const ViewComponent = resolveView(activeTab)
            return (
                <ViewComponent
                    page={activePage}
                    onNavigate={handleNavigate}
                />
            )
        }

        return <div className="p-6 text-muted-foreground">Page not found</div>
    }

    return (
        <div className="flex h-screen bg-background text-foreground">
            {/* Sidebar navigation */}
            <aside
                className={`${navCollapsed ? 'w-14' : 'w-52'} flex-shrink-0 border-r bg-card flex flex-col transition-all duration-200`}
            >
                {/* Brand */}
                <div className="border-b px-3 py-3 flex items-center gap-2">
                    <button
                        onClick={() => setNavCollapsed(!navCollapsed)}
                        className="p-1.5 rounded-md hover:bg-accent text-muted-foreground"
                        title={navCollapsed ? 'Expand' : 'Collapse'}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="4" x2="20" y1="6" y2="6" />
                            <line x1="4" x2="20" y1="12" y2="12" />
                            <line x1="4" x2="20" y1="18" y2="18" />
                        </svg>
                    </button>
                    {!navCollapsed && (
                        <div>
                            <div className="text-sm font-bold tracking-wider">{title || 'PraisonAI'}</div>
                            <div className="text-[10px] text-muted-foreground">Dashboard</div>
                        </div>
                    )}
                </div>

                {/* Chat tab (always first, not from API) */}
                <nav className="flex-1 overflow-y-auto py-2">
                    <div className="mb-1">
                        {!navCollapsed && (
                            <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                Chat
                            </div>
                        )}
                        <button
                            onClick={() => setActiveTab('chat')}
                            className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${activeTab === 'chat'
                                ? 'bg-accent text-accent-foreground font-medium'
                                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                                } ${navCollapsed ? 'justify-center' : ''}`}
                            title="Chat"
                        >
                            <span className="text-base">💬</span>
                            {!navCollapsed && <span>Chat</span>}
                        </button>
                    </div>

                    {/* Protocol-driven tab groups from /api/pages */}
                    {tabGroups.map((group) => (
                        <div key={group.label} className="mb-1">
                            {!navCollapsed && (
                                <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                                    {group.label}
                                </div>
                            )}
                            {group.pages.map((pg) => (
                                <button
                                    key={pg.id}
                                    onClick={() => setActiveTab(pg.id)}
                                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${activeTab === pg.id
                                        ? 'bg-accent text-accent-foreground font-medium'
                                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                                        } ${navCollapsed ? 'justify-center' : ''}`}
                                    title={pg.title}
                                >
                                    <span className="text-base">{pg.icon}</span>
                                    {!navCollapsed && <span>{pg.title}</span>}
                                </button>
                            ))}
                        </div>
                    ))}
                </nav>

                {/* Status indicator */}
                <div className="border-t px-3 py-2">
                    <div className={`flex items-center gap-1.5 ${navCollapsed ? 'justify-center' : ''}`}>
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        {!navCollapsed && (
                            <span className="text-[11px] text-muted-foreground">Connected</span>
                        )}
                    </div>
                </div>
            </aside>

            {/* Main content */}
            <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {activeTab !== 'chat' && activePage && (
                    <header className="border-b px-6 py-3">
                        <h1 className="text-lg font-semibold">{activePage.title}</h1>
                        {activePage.description && (
                            <p className="text-xs text-muted-foreground">{activePage.description}</p>
                        )}
                    </header>
                )}
                <div className="flex-1 overflow-auto">
                    {renderContent()}
                </div>
            </main>
        </div>
    )
}
