import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, ChatConfig, ToolCall } from '../types'
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
    const messagesEndRef = useRef<HTMLDivElement>(null)

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
            setThinkingSteps([])
            setToolCalls([])
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
            setCurrentResponse((prev) => prev + token)
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
        },
        onThinking: (step) => {
            setThinkingSteps((prev) => [...prev, step])
        },
        onToolCall: (toolCall) => {
            setToolCalls((prev) => [...prev, toolCall])
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
        },
        onEnd: () => {
            if (currentResponse) {
                setMessages((prev) => [
                    ...prev,
                    {
                        id: crypto.randomUUID(),
                        role: 'assistant',
                        content: currentResponse,
                        timestamp: new Date().toISOString(),
                        thinking: thinkingSteps.length > 0 ? thinkingSteps : undefined,
                        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                    },
                ])
                setCurrentResponse('')
                setThinkingSteps([])
                setToolCalls([])
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
            setThinkingSteps([])
            setToolCalls([])
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

    const showStarters = messages.length === 0 && !loadingHistory && config?.starters && config.starters.length > 0

    return (
        <div className={`flex flex-col h-full ${className}`}>
            <div className="flex-1 overflow-y-auto p-4">
                {loadingHistory ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                        Loading conversation...
                    </div>
                ) : showStarters ? (
                    <StarterMessages
                        starters={config.starters!}
                        onStarterClick={handleStarterClick}
                    />
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
