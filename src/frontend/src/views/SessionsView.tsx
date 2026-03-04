import { useEffect, useState, useCallback } from 'react'
import type { DashboardPageProps } from '../types/dashboard'

interface Session {
    id: string
    title: string
    created_at: string
    updated_at: string
    message_count: number
}

export function SessionsView({ onNavigate }: DashboardPageProps) {
    // onNavigate('chat') to open chat tab (sessionId not passed via protocol,
    // but the layout component handles session selection separately)
    const [sessions, setSessions] = useState<Session[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editTitle, setEditTitle] = useState('')
    const [filter, setFilter] = useState('')

    const fetchSessions = useCallback(async () => {
        try {
            setLoading(true)
            const res = await fetch('/sessions')
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            setSessions(data.sessions || [])
            setError(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { fetchSessions() }, [fetchSessions])

    const deleteSession = async (id: string) => {
        if (!confirm('Delete this session?')) return
        try {
            const res = await fetch(`/sessions/${id}`, { method: 'DELETE' })
            if (res.ok) setSessions((prev) => prev.filter((s) => s.id !== id))
        } catch { }
    }

    const renameSession = async (id: string) => {
        if (!editTitle.trim()) return
        try {
            await fetch(`/sessions/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: editTitle }),
            })
            setSessions((prev) =>
                prev.map((s) => (s.id === id ? { ...s, title: editTitle } : s))
            )
            setEditingId(null)
        } catch { }
    }

    const filtered = filter
        ? sessions.filter((s) =>
            s.title.toLowerCase().includes(filter.toLowerCase()) ||
            s.id.includes(filter)
        )
        : sessions

    const formatDate = (iso: string) => {
        try {
            return new Date(iso).toLocaleString()
        } catch { return iso }
    }

    if (loading) return <div className="p-6 text-muted-foreground">Loading sessions...</div>
    if (error) return <div className="p-6 text-destructive">Error: {error}</div>

    return (
        <div className="p-6 space-y-4 max-w-5xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">Sessions ({sessions.length})</h2>
                <div className="flex gap-2">
                    <input
                        type="text"
                        placeholder="Filter..."
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="px-3 py-1.5 text-sm rounded-md border bg-background"
                    />
                    <button
                        onClick={fetchSessions}
                        className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent"
                    >
                        ↻
                    </button>
                </div>
            </div>

            {/* Sessions table */}
            {filtered.length === 0 ? (
                <div className="text-center text-muted-foreground py-12">
                    {sessions.length === 0 ? 'No sessions yet. Start a chat to create one.' : 'No sessions match the filter.'}
                </div>
            ) : (
                <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                            <tr>
                                <th className="text-left px-4 py-2 font-medium">Title</th>
                                <th className="text-left px-4 py-2 font-medium">Messages</th>
                                <th className="text-left px-4 py-2 font-medium">Updated</th>
                                <th className="text-right px-4 py-2 font-medium">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((session) => (
                                <tr key={session.id} className="border-t hover:bg-accent/30 transition-colors">
                                    <td className="px-4 py-2.5">
                                        {editingId === session.id ? (
                                            <div className="flex gap-1">
                                                <input
                                                    value={editTitle}
                                                    onChange={(e) => setEditTitle(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && renameSession(session.id)}
                                                    className="px-2 py-0.5 text-sm rounded border bg-background flex-1"
                                                    autoFocus
                                                />
                                                <button
                                                    onClick={() => renameSession(session.id)}
                                                    className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground"
                                                >
                                                    ✓
                                                </button>
                                                <button
                                                    onClick={() => setEditingId(null)}
                                                    className="text-xs px-2 py-0.5 rounded border"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => onNavigate('chat')}
                                                className="text-blue-400 hover:underline font-medium"
                                            >
                                                {session.title || 'Untitled'}
                                            </button>
                                        )}
                                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                                            {session.id.slice(0, 8)}...
                                        </div>
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <span className="text-muted-foreground">{session.message_count}</span>
                                    </td>
                                    <td className="px-4 py-2.5 text-muted-foreground text-xs">
                                        {formatDate(session.updated_at)}
                                    </td>
                                    <td className="px-4 py-2.5 text-right">
                                        <div className="flex gap-1 justify-end">
                                            <button
                                                onClick={() => {
                                                    setEditingId(session.id)
                                                    setEditTitle(session.title || '')
                                                }}
                                                className="text-xs px-2 py-0.5 rounded border hover:bg-accent"
                                                title="Rename"
                                            >
                                                ✏
                                            </button>
                                            <button
                                                onClick={() => deleteSession(session.id)}
                                                className="text-xs px-2 py-0.5 rounded border hover:bg-destructive hover:text-destructive-foreground"
                                                title="Delete"
                                            >
                                                🗑
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
