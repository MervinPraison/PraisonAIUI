import { useCallback, useEffect, useState } from 'react'
import type { ChatMessage, ChatConfig, ChatStarter } from '../types'
import { useSSE } from '../hooks/useSSE'
import { ChatMessages } from './ChatMessages'
import { ChatInput } from './ChatInput'
import { StarterMessages } from './StarterMessages'
import { TaskSidebar } from './TaskSidebar'

interface ChatAreaProps {
    config?: ChatConfig
    className?: string
    sessionId?: string | null
    onSessionChange?: (sessionId: string) => void
}

export function ChatArea({ config, className = '', sessionId: externalSessionId, onSessionChange }: ChatAreaProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [loadingHistory, setLoadingHistory] = useState(false)
    const [dynamicStarters, setDynamicStarters] = useState<ChatStarter[]>([])

    // Fetch starters from backend API
    useEffect(() => {
        fetch('/starters')
            .then((res) => res.json())
            .then((data) => {
                if (data.starters && data.starters.length > 0) {
                    setDynamicStarters(data.starters)
                }
            })
            .catch(() => {
                // No starters endpoint — use static config
            })
    }, [])

    // Load messages when session changes
    useEffect(() => {
        if (externalSessionId) {
            loadSessionMessages(externalSessionId)
        } else if (externalSessionId === null) {
            // Explicitly null = new conversation requested
            setMessages([])
        }
    }, [externalSessionId])

    const loadSessionMessages = async (sid: string) => {
        try {
            setLoadingHistory(true)
            const response = await fetch(`/sessions/${sid}/runs`)
            if (response.ok) {
                const data = await response.json()
                const runs = data.runs || []
                const loaded: ChatMessage[] = runs.map((run: any) => ({
                    id: run.id || crypto.randomUUID(),
                    role: run.role || 'user',
                    content: run.content || run.message || '',
                    timestamp: run.timestamp || new Date().toISOString(),
                    ...(run.toolCalls ? { toolCalls: run.toolCalls } : {}),
                }))
                setMessages(loaded)
            }
        } catch {
            // Silently fail - just show empty chat
        } finally {
            setLoadingHistory(false)
        }
    }

    // All streaming state comes from the store via useSSE
    const {
        isStreaming,
        currentResponse,
        toolCalls,
        thinkingSteps,
        sendMessage,
        cancel,
    } = useSSE({
        externalSessionId,
        onSessionId: (newSessionId) => {
            onSessionChange?.(newSessionId)
        },
        onEnd: () => {
            // When the stream ends for THIS session, reload its messages from server
            // so the persisted assistant message appears in the list
            if (externalSessionId) {
                loadSessionMessages(externalSessionId)
            }
        },
    })

    const handleSend = useCallback(
        async (message: string) => {
            setMessages((prev) => [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    role: 'user',
                    content: message,
                    timestamp: new Date().toISOString(),
                },
            ])
            sendMessage(message)
        },
        [sendMessage],
    )

    const handleStarterClick = useCallback(
        (message: string) => {
            handleSend(message)
        },
        [handleSend],
    )

    const effectiveStarters = dynamicStarters.length > 0 ? dynamicStarters : (config?.starters || [])
    const showStarters = messages.length === 0 && !loadingHistory && effectiveStarters.length > 0 && !isStreaming
    const showEmpty = messages.length === 0 && !loadingHistory && !showStarters && !isStreaming

    const handleTaskClick = (taskForId: string) => {
        // Scroll to message with the given ID
        const element = document.getElementById(taskForId)
        if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
    }

    return (
        <div className={`flex h-full ${className}`}>
            {/* Main chat area */}
            <div className="flex flex-col flex-1 min-w-0">
                <div className="flex-1 overflow-y-auto p-4">
                    {loadingHistory ? (
                        <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                            Loading conversation...
                        </div>
                    ) : showStarters ? (
                        <StarterMessages
                            starters={effectiveStarters}
                            onStarterClick={handleStarterClick}
                        />
                    ) : showEmpty ? (
                        <div className="flex flex-col items-center justify-center h-full text-center">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white mb-4">
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
                                </svg>
                            </div>
                            <h2 className="text-xl font-semibold mb-1">{config?.name || 'AI Chat'}</h2>
                            <p className="text-sm text-muted-foreground">How can I help you today?</p>
                        </div>
                    ) : (
                        <ChatMessages
                            messages={messages}
                            currentResponse={currentResponse}
                            thinkingSteps={thinkingSteps}
                            toolCalls={toolCalls}
                            isStreaming={isStreaming}
                        />
                    )}
                    <div className="h-4" />
                </div>
                <ChatInput
                    onSend={handleSend}
                    onCancel={cancel}
                    isStreaming={isStreaming}
                    placeholder={config?.input?.placeholder}
                    enableFileUpload={config?.features?.fileUpload}
                />
            </div>
            
            {/* Task sidebar */}
            <TaskSidebar
                sessionId={externalSessionId || 'default'}
                onTaskClick={handleTaskClick}
            />
        </div>
    )
}
