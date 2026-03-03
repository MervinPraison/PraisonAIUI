import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, ChatConfig, ToolCall } from '../types'
import { useSSE } from '../hooks/useSSE'
import { ChatMessages } from './ChatMessages'
import { ChatInput } from './ChatInput'
import { StarterMessages } from './StarterMessages'

interface ChatAreaProps {
    config?: ChatConfig
    className?: string
}

export function ChatArea({ config, className = '' }: ChatAreaProps) {
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [currentResponse, setCurrentResponse] = useState('')
    const [thinkingSteps, setThinkingSteps] = useState<string[]>([])
    const [toolCalls, setToolCalls] = useState<ToolCall[]>([])
    const messagesEndRef = useRef<HTMLDivElement>(null)

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [])

    useEffect(() => {
        scrollToBottom()
    }, [messages, currentResponse, scrollToBottom])

    const { isStreaming, sendMessage, cancel } = useSSE({
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

    const showStarters = messages.length === 0 && config?.starters && config.starters.length > 0

    return (
        <div className={`flex flex-col h-full ${className}`}>
            <div className="flex-1 overflow-y-auto p-4">
                {showStarters ? (
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
