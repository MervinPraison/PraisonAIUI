import { useCallback, useState } from 'react'
import type { ChatConfig, LayoutConfig } from '../types'
import { ChatArea, SessionManager } from '../chat'

interface ChatLayoutProps {
    config?: ChatConfig
    layout?: LayoutConfig
    title?: string
}

export function ChatLayout({ config, layout, title }: ChatLayoutProps) {
    const mode = layout?.mode || 'fullscreen'
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
    const [showSessions, setShowSessions] = useState(true)

    const handleSessionSelect = useCallback((sessionId: string) => {
        setCurrentSessionId(sessionId)
    }, [])

    const handleNewSession = useCallback(() => {
        setCurrentSessionId(null)
    }, [])

    if (mode === 'fullscreen') {
        return (
            <div className="flex h-screen bg-background">
                {/* Session sidebar */}
                {showSessions && config?.features?.history !== false && (
                    <aside className="w-64 border-r flex-shrink-0">
                        <SessionManager
                            currentSessionId={currentSessionId}
                            onSessionSelect={handleSessionSelect}
                            onNewSession={handleNewSession}
                            className="h-full"
                        />
                    </aside>
                )}
                <div className="flex-1 flex flex-col">
                    <header className="border-b px-4 py-3 flex items-center gap-3">
                        <button
                            onClick={() => setShowSessions(!showSessions)}
                            className="p-1.5 rounded-md hover:bg-accent"
                            title={showSessions ? 'Hide sessions' : 'Show sessions'}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                                <line x1="9" x2="9" y1="3" y2="21" />
                            </svg>
                        </button>
                        <h1 className="text-lg font-semibold">{title || config?.name || 'AI Chat'}</h1>
                    </header>
                    <main className="flex-1 overflow-hidden">
                        <ChatArea config={config} className="h-full" />
                    </main>
                </div>
            </div>
        )
    }

    if (mode === 'sidebar') {
        return (
            <div
                className="fixed right-0 top-0 h-screen border-l bg-background shadow-lg flex flex-col"
                style={{ width: layout?.width || '400px' }}
            >
                <header className="border-b px-4 py-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">{config?.name || 'AI Chat'}</h2>
                </header>
                <main className="flex-1 overflow-hidden">
                    <ChatArea config={config} className="h-full" />
                </main>
            </div>
        )
    }

    // Floating widget modes (bottom-right, bottom-left, top-right, top-left)
    const positionClasses: Record<string, string> = {
        'bottom-right': 'bottom-4 right-4',
        'bottom-left': 'bottom-4 left-4',
        'top-right': 'top-4 right-4',
        'top-left': 'top-4 left-4',
    }

    const positionClass = positionClasses[mode] || positionClasses['bottom-right']

    return (
        <div
            className={`fixed ${positionClass} bg-background border rounded-lg shadow-xl flex flex-col overflow-hidden`}
            style={{
                width: layout?.width || '380px',
                height: layout?.height || '500px',
            }}
        >
            <header className="border-b px-3 py-2 flex items-center justify-between bg-muted/30">
                <h2 className="text-sm font-semibold">{config?.name || 'AI Chat'}</h2>
            </header>
            <main className="flex-1 overflow-hidden">
                <ChatArea config={config} className="h-full" />
            </main>
        </div>
    )
}
