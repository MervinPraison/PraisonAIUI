import { useCallback, useState } from 'react'
import type { ChatConfig, ChatProfile } from '../types'
import { ChatArea, SessionManager } from '../chat'

interface AgentUILayoutProps {
    config?: ChatConfig
    title?: string
}

export function AgentUILayout({ config, title }: AgentUILayoutProps) {
    const profiles = config?.profiles || []
    const defaultProfile = profiles.find((p) => p.default) || profiles[0]
    const [selectedProfile, setSelectedProfile] = useState<ChatProfile | undefined>(defaultProfile)
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
    const [activeTab, setActiveTab] = useState<'agents' | 'sessions'>('agents')

    const handleSessionSelect = useCallback((sessionId: string) => {
        setCurrentSessionId(sessionId)
    }, [])

    const handleNewSession = useCallback(() => {
        setCurrentSessionId(null)
    }, [])

    return (
        <div className="flex h-screen bg-background">
            {/* Sidebar */}
            <aside className="w-64 border-r flex flex-col">
                <header className="border-b px-4 py-3">
                    <h1 className="text-lg font-semibold">{title || 'AI Agents'}</h1>
                </header>
                {/* Tab switcher */}
                <div className="flex border-b">
                    <button
                        onClick={() => setActiveTab('agents')}
                        className={`flex-1 px-3 py-2 text-sm font-medium ${
                            activeTab === 'agents'
                                ? 'border-b-2 border-primary text-primary'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        Agents
                    </button>
                    <button
                        onClick={() => setActiveTab('sessions')}
                        className={`flex-1 px-3 py-2 text-sm font-medium ${
                            activeTab === 'sessions'
                                ? 'border-b-2 border-primary text-primary'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        History
                    </button>
                </div>
                {activeTab === 'sessions' ? (
                    <SessionManager
                        currentSessionId={currentSessionId}
                        onSessionSelect={handleSessionSelect}
                        onNewSession={handleNewSession}
                        className="flex-1"
                    />
                ) : (
                    <>
                        <div className="flex-1 overflow-y-auto p-2">
                            <div className="space-y-1">
                                {profiles.map((profile) => (
                                    <button
                                        key={profile.name}
                                        onClick={() => setSelectedProfile(profile)}
                                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors ${
                                            selectedProfile?.name === profile.name
                                                ? 'bg-accent'
                                                : 'hover:bg-accent/50'
                                        }`}
                                    >
                                        {profile.icon && <span>{profile.icon}</span>}
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium truncate">{profile.name}</p>
                                            {profile.description && (
                                                <p className="text-xs text-muted-foreground truncate">
                                                    {profile.description}
                                                </p>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="border-t p-2">
                            <button className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-accent/50">
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                                    <circle cx="12" cy="12" r="3" />
                                </svg>
                                Settings
                            </button>
                        </div>
                    </>
                )}
            </aside>

            {/* Main chat area */}
            <main className="flex-1 flex flex-col overflow-hidden">
                {selectedProfile && (
                    <header className="border-b px-4 py-3 flex items-center gap-3">
                        {selectedProfile.icon && (
                            <span className="text-xl">{selectedProfile.icon}</span>
                        )}
                        <div>
                            <h2 className="font-semibold">{selectedProfile.name}</h2>
                            {selectedProfile.description && (
                                <p className="text-xs text-muted-foreground">
                                    {selectedProfile.description}
                                </p>
                            )}
                        </div>
                    </header>
                )}
                <div className="flex-1 overflow-hidden">
                    <ChatArea config={config} className="h-full" />
                </div>
            </main>
        </div>
    )
}
