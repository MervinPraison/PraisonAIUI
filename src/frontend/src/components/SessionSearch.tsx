import { useEffect, useRef, useState, useCallback } from 'react'

interface Session {
    id: string
    title: string
    created_at: string
    updated_at: string
    message_count: number
}

interface SessionSearchProps {
    isOpen: boolean
    onClose: () => void
    onSessionSelect: (sessionId: string) => void
}

export function SessionSearch({ isOpen, onClose, onSessionSelect }: SessionSearchProps) {
    const [query, setQuery] = useState('')
    const [sessions, setSessions] = useState<Session[]>([])
    const [filteredSessions, setFilteredSessions] = useState<Session[]>([])
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [loading, setLoading] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const modalRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (isOpen) {
            fetchSessions()
            setQuery('')
            setSelectedIndex(0)
            inputRef.current?.focus()
        }
    }, [isOpen])

    const fetchSessions = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch('/sessions')
            if (res.ok) {
                const data = await res.json()
                setSessions(data.sessions || [])
                setFilteredSessions(data.sessions || [])
            }
        } catch (err) {
            console.error('Failed to fetch sessions:', err)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        if (query.trim()) {
            const lowerQuery = query.toLowerCase()
            const filtered = sessions.filter(session =>
                session.title?.toLowerCase().includes(lowerQuery) ||
                session.id.toLowerCase().includes(lowerQuery)
            )
            setFilteredSessions(filtered)
        } else {
            setFilteredSessions(sessions)
        }
        setSelectedIndex(0)
    }, [query, sessions])

    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose()
            }
        }
        document.addEventListener('keydown', handleEscape)
        return () => document.removeEventListener('keydown', handleEscape)
    }, [isOpen, onClose])

    const handleKeyDown = (e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault()
                setSelectedIndex(prev => Math.min(prev + 1, filteredSessions.length - 1))
                break
            case 'ArrowUp':
                e.preventDefault()
                setSelectedIndex(prev => Math.max(prev - 1, 0))
                break
            case 'Enter':
                e.preventDefault()
                if (filteredSessions[selectedIndex]) {
                    onSessionSelect(filteredSessions[selectedIndex].id)
                    onClose()
                }
                break
        }
    }

    const handleClickOutside = (e: MouseEvent) => {
        if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
            onClose()
        }
    }

    useEffect(() => {
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside)
            return () => document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isOpen])

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-background/80 backdrop-blur-sm">
            <div ref={modalRef} className="w-full max-w-2xl rounded-lg border bg-popover shadow-lg">
                <div className="flex items-center border-b px-3">
                    <svg className="w-4 h-4 text-muted-foreground mr-2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.35-4.35" />
                    </svg>
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Search sessions..."
                        className="flex-1 h-12 bg-transparent outline-none"
                    />
                    <kbd className="px-2 py-1 text-xs font-semibold bg-muted text-muted-foreground rounded">ESC</kbd>
                </div>

                <div className="max-h-[50vh] overflow-y-auto">
                    {loading ? (
                        <div className="p-4 text-center text-muted-foreground">Loading...</div>
                    ) : filteredSessions.length === 0 ? (
                        <div className="p-8 text-center">
                            <div className="text-muted-foreground mb-2">No sessions found</div>
                            {sessions.length === 0 ? (
                                <div className="text-sm text-muted-foreground">Start a chat to create your first session</div>
                            ) : (
                                <div className="text-sm text-muted-foreground">Try a different search term</div>
                            )}
                        </div>
                    ) : (
                        <div className="py-2">
                            {filteredSessions.map((session, index) => (
                                <button
                                    key={session.id}
                                    onClick={() => {
                                        onSessionSelect(session.id)
                                        onClose()
                                    }}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                    className={`w-full px-3 py-2 flex items-center justify-between hover:bg-accent ${
                                        index === selectedIndex ? 'bg-accent' : ''
                                    }`}
                                >
                                    <div className="flex-1 text-left">
                                        <div className="font-medium text-sm">{session.title || 'Untitled Session'}</div>
                                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                                            <span>{session.message_count} messages</span>
                                            <span className="font-mono">{session.id.slice(0, 8)}</span>
                                        </div>
                                    </div>
                                    {index === selectedIndex && (
                                        <kbd className="px-2 py-1 text-xs font-semibold bg-muted text-muted-foreground rounded">↵</kbd>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}