import { useCallback, useRef, useState } from 'react'
import type { SSEEvent, ToolCall } from '../types'

interface UseSSEOptions {
    onToken?: (token: string) => void
    onMessage?: (content: string) => void
    onThinking?: (step: string) => void
    onToolCall?: (toolCall: ToolCall) => void
    onError?: (error: string) => void
    onEnd?: () => void
    onSessionId?: (sessionId: string) => void
    externalSessionId?: string | null
}

interface UseSSEReturn {
    isStreaming: boolean
    sessionId: string | null
    sendMessage: (message: string, agentName?: string) => void
    cancel: () => void
}

export function useSSE(options: UseSSEOptions = {}): UseSSEReturn {
    // Initialize sessionId from URL query param if present
    const getInitialSessionId = (): string | null => {
        if (typeof window === 'undefined') return null
        const params = new URLSearchParams(window.location.search)
        return params.get('session')
    }

    const [isStreaming, setIsStreaming] = useState(false)
    const [internalSessionId, setInternalSessionId] = useState<string | null>(getInitialSessionId)
    const abortControllerRef = useRef<AbortController | null>(null)

    // Use external session ID if provided, otherwise use internal
    const sessionId = options.externalSessionId !== undefined ? options.externalSessionId : internalSessionId

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
    }, [isStreaming, sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

    const handleEvent = useCallback((event: SSEEvent) => {
        switch (event.type) {
            // Session events
            case 'session':
                if (event.session_id) {
                    setInternalSessionId(event.session_id)
                    options.onSessionId?.(event.session_id)
                    // Update URL with session ID for bookmarkability
                    if (typeof window !== 'undefined') {
                        const url = new URL(window.location.href)
                        url.searchParams.set('session', event.session_id)
                        window.history.replaceState({}, '', url.toString())
                    }
                }
                break

            // Token streaming (legacy + new)
            case 'token':
            case 'run_content':
            case 'team_run_content':
                if (event.token) {
                    options.onToken?.(event.token)
                } else if (event.content) {
                    options.onToken?.(event.content)
                }
                break

            // Message complete
            case 'message':
            case 'run_completed':
            case 'team_run_completed':
                if (event.content) {
                    options.onMessage?.(event.content)
                }
                break

            // Reasoning/thinking (legacy + new)
            case 'thinking':
            case 'reasoning_step':
            case 'team_reasoning_step':
                if (event.step) {
                    options.onThinking?.(event.step)
                }
                break

            // Reasoning lifecycle
            case 'reasoning_started':
            case 'team_reasoning_started':
                options.onThinking?.('Starting reasoning...')
                break
            case 'reasoning_completed':
            case 'team_reasoning_completed':
                options.onThinking?.('Reasoning complete')
                break

            // Tool calls (legacy + new)
            case 'tool_call':
            case 'tool_call_started':
            case 'team_tool_call_started':
                if (event.name) {
                    options.onToolCall?.({
                        name: event.name,
                        description: event.description,
                        icon: event.icon,
                        step_number: event.step_number,
                        status: 'running',
                        tool_call_id: event.tool_call_id,
                        args: event.args,
                    })
                }
                break
            case 'tool_call_completed':
            case 'team_tool_call_completed':
                if (event.name) {
                    options.onToolCall?.({
                        name: event.name,
                        description: event.description,
                        icon: event.icon,
                        step_number: event.step_number,
                        status: 'done',
                        tool_call_id: event.tool_call_id,
                        formatted_result: event.formatted_result,
                        args: event.args,
                        result: event.result,
                    })
                }
                break

            // Memory updates
            case 'updating_memory':
            case 'memory_update_started':
            case 'team_memory_update_started':
                options.onThinking?.('Updating memory...')
                break
            case 'memory_update_completed':
            case 'team_memory_update_completed':
                options.onThinking?.('Memory updated')
                break

            // Run lifecycle
            case 'run_started':
            case 'team_run_started':
                // Run started - could trigger loading state
                break
            case 'run_paused':
                options.onThinking?.('Run paused')
                break
            case 'run_continued':
                options.onThinking?.('Run continued')
                break

            // Errors
            case 'error':
            case 'run_error':
            case 'team_run_error':
                if (event.error) {
                    options.onError?.(event.error)
                }
                break

            // Cancelled
            case 'run_cancelled':
            case 'team_run_cancelled':
                options.onEnd?.()
                break

            // End events
            case 'end':
            case 'done':
                options.onEnd?.()
                break
        }
    }, [options])

    const cancel = useCallback(async () => {
        // Client-side abort
        abortControllerRef.current?.abort()
        setIsStreaming(false)

        // Server-side abort - cancel the running task
        if (sessionId) {
            try {
                await fetch('/cancel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session_id: sessionId }),
                })
            } catch {
                // Ignore errors - best effort cancellation
            }
        }
    }, [sessionId])

    return {
        isStreaming,
        sessionId,
        sendMessage,
        cancel,
    }
}
