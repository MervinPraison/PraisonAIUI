import { useCallback, useEffect, useState } from 'react'

interface Session {
    id: string
    created_at: string
    updated_at: string
    message_count: number
}

interface SessionManagerProps {
    currentSessionId?: string | null
    onSessionSelect: (sessionId: string) => void
    onNewSession: () => void
    className?: string
}

export function SessionManager({
    currentSessionId,
    onSessionSelect,
    onNewSession,
    className = '',
}: SessionManagerProps) {
    const [sessions, setSessions] = useState<Session[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const fetchSessions = useCallback(async () => {
        try {
            setLoading(true)
            const response = await fetch('/sessions')
            if (!response.ok) throw new Error('Failed to fetch sessions')
            const data = await response.json()
            setSessions(data.sessions || [])
            setError(null)
        } catch (err) {
            setError((err as Error).message)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchSessions()
    }, [fetchSessions])

    const handleDelete = useCallback(async (sessionId: string, e: React.MouseEvent) => {
        e.stopPropagation()
        try {
            const response = await fetch(`/sessions/${sessionId}`, { method: 'DELETE' })
            if (!response.ok) throw new Error('Failed to delete session')
            setSessions((prev) => prev.filter((s) => s.id !== sessionId))
        } catch (err) {
            setError((err as Error).message)
        }
    }, [])

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr)
        const now = new Date()
        const diffMs = now.getTime() - date.getTime()
        const diffMins = Math.floor(diffMs / 60000)
        const diffHours = Math.floor(diffMins / 60)
        const diffDays = Math.floor(diffHours / 24)

        if (diffMins < 1) return 'Just now'
        if (diffMins < 60) return `${diffMins}m ago`
        if (diffHours < 24) return `${diffHours}h ago`
        if (diffDays < 7) return `${diffDays}d ago`
        return date.toLocaleDateString()
    }

    return (
        <div className={`flex flex-col h-full ${className}`}>
            <div className="flex items-center justify-between p-3 border-b">
                <h2 className="text-sm font-semibold">Conversations</h2>
                <button
                    onClick={onNewSession}
                    className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
                    title="New conversation"
                >
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
                        <path d="M12 5v14M5 12h14" />
                    </svg>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="p-4 text-center text-muted-foreground text-sm">
                        Loading...
                    </div>
                ) : error ? (
                    <div className="p-4 text-center text-destructive text-sm">
                        {error}
                    </div>
                ) : sessions.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground text-sm">
                        No conversations yet
                    </div>
                ) : (
                    <div className="space-y-1 p-2">
                        {sessions.map((session) => (
                            <button
                                key={session.id}
                                onClick={() => onSessionSelect(session.id)}
                                className={`w-full flex items-center justify-between p-2 rounded-md text-left text-sm transition-colors group ${
                                    currentSessionId === session.id
                                        ? 'bg-accent text-accent-foreground'
                                        : 'hover:bg-accent/50'
                                }`}
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="truncate font-medium">
                                        Conversation
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span>{session.message_count} messages</span>
                                        <span>·</span>
                                        <span>{formatDate(session.updated_at)}</span>
                                    </div>
                                </div>
                                <button
                                    onClick={(e) => handleDelete(session.id, e)}
                                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                                    title="Delete conversation"
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                    </svg>
                                </button>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
