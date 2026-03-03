import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, ToolCall } from '../types'

interface UseWebSocketOptions {
    url?: string
    agentId?: string
    onToken?: (token: string) => void
    onMessage?: (content: string) => void
    onThinking?: (step: string) => void
    onToolCall?: (toolCall: ToolCall) => void
    onError?: (error: string) => void
    onEnd?: () => void
    onSessionInfo?: (sessionId: string) => void
}

interface UseWebSocketReturn {
    isConnected: boolean
    isStreaming: boolean
    sessionId: string | null
    messages: ChatMessage[]
    sendMessage: (content: string) => void
    cancel: () => void
    connect: () => void
    disconnect: () => void
}

export function useWebSocket({
    url = 'ws://localhost:8765/ws',
    agentId = 'default',
    onToken,
    onMessage,
    onThinking,
    onToolCall,
    onError,
    onEnd,
    onSessionInfo,
}: UseWebSocketOptions = {}): UseWebSocketReturn {
    const [isConnected, setIsConnected] = useState(false)
    const [isStreaming, setIsStreaming] = useState(false)
    const [sessionId, setSessionId] = useState<string | null>(null)
    const [messages, setMessages] = useState<ChatMessage[]>([])

    const wsRef = useRef<WebSocket | null>(null)
    const streamingContentRef = useRef('')

    // Store callbacks in refs to avoid dependency issues
    const callbacksRef = useRef({
        onToken,
        onMessage,
        onThinking,
        onToolCall,
        onError,
        onEnd,
        onSessionInfo,
    })

    // Update refs in effect to avoid render-time mutation
    useEffect(() => {
        callbacksRef.current = {
            onToken,
            onMessage,
            onThinking,
            onToolCall,
            onError,
            onEnd,
            onSessionInfo,
        }
    })

    const handleMessage = useCallback((data: Record<string, unknown>) => {
        const type = data.type as string
        const cb = callbacksRef.current

        switch (type) {
            case 'joined': {
                setSessionId(data.session_id as string)
                cb.onSessionInfo?.(data.session_id as string)
                break
            }

            case 'token_stream':
            case 'TOKEN_STREAM': {
                setIsStreaming(true)
                const token = (data.data as Record<string, unknown>)?.content as string || data.content as string || ''
                streamingContentRef.current += token
                cb.onToken?.(token)
                break
            }

            case 'response': {
                setIsStreaming(false)
                const content = data.content as string || ''
                if (content) {
                    cb.onMessage?.(content)
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `msg-${Date.now()}`,
                            role: 'assistant',
                            content,
                            timestamp: new Date().toISOString(),
                        },
                    ])
                }
                streamingContentRef.current = ''
                cb.onEnd?.()
                break
            }

            case 'tool_call_stream':
            case 'TOOL_CALL_STREAM': {
                const toolData = (data.data as Record<string, unknown>)?.tool_call as ToolCall || data.tool_call as ToolCall
                if (toolData) {
                    cb.onToolCall?.(toolData)
                }
                break
            }

            case 'stream_end':
            case 'STREAM_END': {
                setIsStreaming(false)
                if (streamingContentRef.current) {
                    const finalContent = streamingContentRef.current
                    cb.onMessage?.(finalContent)
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `msg-${Date.now()}`,
                            role: 'assistant',
                            content: finalContent,
                            timestamp: new Date().toISOString(),
                        },
                    ])
                    streamingContentRef.current = ''
                }
                cb.onEnd?.()
                break
            }

            case 'thinking': {
                const step = data.step as string || (data.data as Record<string, unknown>)?.step as string || ''
                if (step) {
                    cb.onThinking?.(step)
                }
                break
            }

            case 'error': {
                const errorMsg = data.message as string || 'Unknown error'
                cb.onError?.(errorMsg)
                setIsStreaming(false)
                break
            }

            case 'left':
                setSessionId(null)
                break
        }
    }, [])

    const connect = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            return
        }

        const ws = new WebSocket(url)
        wsRef.current = ws

        ws.onopen = () => {
            setIsConnected(true)
            ws.send(JSON.stringify({
                type: 'join',
                agent_id: agentId,
            }))
        }

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data)
                handleMessage(data)
            } catch (e) {
                console.error('Failed to parse WebSocket message:', e)
            }
        }

        ws.onerror = (error) => {
            console.error('WebSocket error:', error)
            callbacksRef.current.onError?.('WebSocket connection error')
        }

        ws.onclose = () => {
            setIsConnected(false)
            setSessionId(null)
        }
    }, [url, agentId, handleMessage])

    const disconnect = useCallback(() => {
        if (wsRef.current) {
            // Send leave message before closing
            if (wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'leave' }))
            }
            wsRef.current.close()
            wsRef.current = null
        }
        setIsConnected(false)
        setSessionId(null)
    }, [])

    const sendMessage = useCallback((content: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            onError?.('Not connected to server')
            return
        }

        if (!sessionId) {
            onError?.('Not joined to a session')
            return
        }

        // Add user message to local state
        setMessages((prev) => [
            ...prev,
            {
                id: `msg-${Date.now()}`,
                role: 'user',
                content,
                timestamp: new Date().toISOString(),
            },
        ])

        // Send to server
        setIsStreaming(true)
        streamingContentRef.current = ''
        wsRef.current.send(JSON.stringify({
            type: 'message',
            content,
        }))
    }, [sessionId, onError])

    const cancel = useCallback(() => {
        // WebSocket doesn't have a built-in cancel mechanism
        // The best we can do is stop processing incoming tokens
        setIsStreaming(false)
        streamingContentRef.current = ''
    }, [])

    // Auto-connect on mount
    useEffect(() => {
        connect()
        return () => {
            disconnect()
        }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    return {
        isConnected,
        isStreaming,
        sessionId,
        messages,
        sendMessage,
        cancel,
        connect,
        disconnect,
    }
}
