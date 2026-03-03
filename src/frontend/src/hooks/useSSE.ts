import { useCallback, useRef, useState } from 'react'
import type { SSEEvent, ToolCall } from '../types'

interface UseSSEOptions {
    onToken?: (token: string) => void
    onMessage?: (content: string) => void
    onThinking?: (step: string) => void
    onToolCall?: (toolCall: ToolCall) => void
    onError?: (error: string) => void
    onEnd?: () => void
}

interface UseSSEReturn {
    isStreaming: boolean
    sessionId: string | null
    sendMessage: (message: string, agentName?: string) => Promise<void>
    cancel: () => void
}

export function useSSE(options: UseSSEOptions = {}): UseSSEReturn {
    const [isStreaming, setIsStreaming] = useState(false)
    const [sessionId, setSessionId] = useState<string | null>(null)
    const abortControllerRef = useRef<AbortController | null>(null)

    const sendMessage = useCallback(async (message: string, agentName?: string) => {
        if (isStreaming) return

        setIsStreaming(true)
        abortControllerRef.current = new AbortController()

        try {
            const response = await fetch('/run', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message,
                    session_id: sessionId,
                    agent: agentName,
                }),
                signal: abortControllerRef.current.signal,
            })

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`)
            }

            const reader = response.body?.getReader()
            if (!reader) {
                throw new Error('No response body')
            }

            const decoder = new TextDecoder()
            let buffer = ''

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const event: SSEEvent = JSON.parse(line.slice(6))
                            handleEvent(event)
                        } catch {
                            // Ignore parse errors
                        }
                    }
                }
            }
        } catch (error) {
            if ((error as Error).name !== 'AbortError') {
                options.onError?.((error as Error).message)
            }
        } finally {
            setIsStreaming(false)
            abortControllerRef.current = null
        }
    }, [isStreaming, sessionId, options])

    const handleEvent = useCallback((event: SSEEvent) => {
        switch (event.type) {
            case 'session':
                if (event.session_id) {
                    setSessionId(event.session_id)
                }
                break
            case 'token':
                if (event.token) {
                    options.onToken?.(event.token)
                }
                break
            case 'message':
                if (event.content) {
                    options.onMessage?.(event.content)
                }
                break
            case 'thinking':
                if (event.step) {
                    options.onThinking?.(event.step)
                }
                break
            case 'tool_call':
                if (event.name) {
                    options.onToolCall?.({
                        name: event.name,
                        args: event.args,
                        result: event.result,
                    })
                }
                break
            case 'error':
                if (event.error) {
                    options.onError?.(event.error)
                }
                break
            case 'end':
            case 'done':
                options.onEnd?.()
                break
        }
    }, [options])

    const cancel = useCallback(() => {
        abortControllerRef.current?.abort()
        setIsStreaming(false)
    }, [])

    return {
        isStreaming,
        sessionId,
        sendMessage,
        cancel,
    }
}
