import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, ChatConfig, ChatStarter, ToolCall } from '../types'
import { useSSE } from '../hooks/useSSE'
import { ChatMessages } from './ChatMessages'
import { ChatInput } from './ChatInput'
import { StarterMessages } from './StarterMessages'

interface ChatAreaProps {
    config?: ChatConfig
    className?: string
    sessionId?: string | null
    onSessionChange?: (sessionId: string) => void
}

export function ChatArea({ config, className = '', sessionId: externalSessionId, onSessionChange }: ChatAreaProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [currentResponse, setCurrentResponse] = useState('')
    const [thinkingSteps, setThinkingSteps] = useState<string[]>([])
    const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
    const [loadingHistory, setLoadingHistory] = useState(false)
    const [dynamicStarters, setDynamicStarters] = useState<ChatStarter[]>([])
    const messagesEndRef = useRef<HTMLDivElement>(null)

    // Refs to avoid stale closures in callbacks
    const currentResponseRef = useRef('')
    const thinkingStepsRef = useRef<string[]>([])
    const toolCallsRef = useRef<ToolCall[]>([])

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

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [])

    useEffect(() => {
        scrollToBottom()
    }, [messages, currentResponse, scrollToBottom])

    // Load messages when session changes
    useEffect(() => {
        if (externalSessionId) {
            loadSessionMessages(externalSessionId)
        } else if (externalSessionId === null) {
            // Explicitly null = new conversation requested
            setMessages([])
            setCurrentResponse('')
            currentResponseRef.current = ''
            setThinkingSteps([])
            thinkingStepsRef.current = []
            setToolCalls([])
            toolCallsRef.current = []
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

    const { isStreaming, sendMessage, cancel } = useSSE({
        externalSessionId: externalSessionId,
        onSessionId: (newSessionId) => {
            // Notify parent about new session ID from backend
            onSessionChange?.(newSessionId)
        },
        onToken: (token) => {
            setCurrentResponse((prev) => {
                const next = prev + token
                currentResponseRef.current = next
                return next
            })
        },
        onMessage: (content) => {
            setMessages((prev) => [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content,
                    timestamp: new Date().toISOString(),
                },
            ])
            setCurrentResponse('')
            currentResponseRef.current = ''
        },
        onThinking: (step) => {
            setThinkingSteps((prev) => {
                const next = [...prev, step]
                thinkingStepsRef.current = next
                return next
            })
        },
        onToolCall: (toolCall) => {
            setToolCalls((prev) => {
                // Upsert by tool_call_id to avoid duplicating started+completed
                if (toolCall.tool_call_id) {
                    const idx = prev.findIndex(tc => tc.tool_call_id === toolCall.tool_call_id)
                    if (idx >= 0) {
                        const next = [...prev]
                        next[idx] = { ...next[idx], ...toolCall }
                        toolCallsRef.current = next
                        return next
                    }
                }
                const next = [...prev, toolCall]
                toolCallsRef.current = next
                return next
            })
        },
        onError: (error) => {
            setMessages((prev) => [
                ...prev,
                {
                    id: crypto.randomUUID(),
                    role: 'assistant',
                    content: `Error: ${error}`,
                    timestamp: new Date().toISOString(),
                },
            ])
            setCurrentResponse('')
            currentResponseRef.current = ''
        },
        onEnd: () => {
            // Use refs to avoid stale closure — always read latest values
            const resp = currentResponseRef.current
            const tcs = toolCallsRef.current
            if (resp || tcs.length > 0) {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: crypto.randomUUID(),
                        role: 'assistant',
                        content: resp || '',
                        timestamp: new Date().toISOString(),
                        toolCalls: tcs.length > 0 ? [...tcs] : undefined,
                    },
                ])
                setCurrentResponse('')
                currentResponseRef.current = ''
            }
            setThinkingSteps([])
            thinkingStepsRef.current = []
            setToolCalls([])
            toolCallsRef.current = []
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
            setThinkingSteps([])
            thinkingStepsRef.current = []
            setToolCalls([])
            toolCallsRef.current = []
            await sendMessage(message)
        },
        [sendMessage]
    )

    const handleStarterClick = useCallback(
        (message: string) => {
            handleSend(message)
        },
        [handleSend]
    )

    // Use dynamic starters (from API) if available, fallback to static config starters
    const effectiveStarters = dynamicStarters.length > 0 ? dynamicStarters : (config?.starters || [])
    const showStarters = messages.length === 0 && !loadingHistory && effectiveStarters.length > 0
    const showEmpty = messages.length === 0 && !loadingHistory && !showStarters

    return (
        <div className={`flex flex-col h-full ${className}`}>
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
                <div ref={messagesEndRef} />
            </div>
            <ChatInput
                onSend={handleSend}
                onCancel={cancel}
                isStreaming={isStreaming}
                placeholder={config?.input?.placeholder}
                enableFileUpload={config?.features?.fileUpload}
            />
        </div>
    )
}
