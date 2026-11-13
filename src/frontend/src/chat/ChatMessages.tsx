import { useState, useCallback, type FormEvent } from 'react'
import { Markdown } from '../markdown/LazyMarkdown'
import type { ChatMessage, ToolCall } from '../types'
import { ToolCallDisplay } from './ToolCallDisplay'
import { ElementRenderer } from './MultimediaElements'
import { ActionButtons } from './ActionButtons'

interface ChatMessagesProps {
    messages: ChatMessage[]
    currentResponse: string
    thinkingSteps: string[]
    toolCalls: ToolCall[]
    pendingElements?: (import('../types').MessageElementUnion | Record<string, unknown>)[]
    isStreaming: boolean
    sessionId?: string
}

export function ChatMessages({
    messages,
    currentResponse,
    thinkingSteps,
    toolCalls,
    pendingElements = [],
    isStreaming,
    sessionId,
}: ChatMessagesProps) {
    return (
        <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((message) => (
                <MessageBubble key={message.id} message={message} sessionId={sessionId} />
            ))}
            {isStreaming && (
                <div className="space-y-3">
                    {thinkingSteps.length > 0 && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground pl-12">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                            <span className="italic">{thinkingSteps[thinkingSteps.length - 1]}</span>
                        </div>
                    )}
                    {toolCalls.length > 0 && (
                        <div className="space-y-1 pl-12">
                            {toolCalls.map((tc, i) => (
                                <ToolCallDisplay key={i} toolCall={tc} />
                            ))}
                        </div>
                    )}
                    {(currentResponse || pendingElements.length > 0) ? (
                        <div className="flex gap-3">
                            <Avatar role="assistant" />
                            <div className="flex-1 min-w-0">
                                {currentResponse && <MarkdownContent content={currentResponse} streaming />}
                                {pendingElements.length > 0 && (
                                    <div className={`space-y-3 ${currentResponse ? 'mt-3' : ''}`}>
                                        {pendingElements.map((element, i) => (
                                            <ElementRenderer key={i} element={element} className="w-full" />
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <StreamLoadingBubble />
                    )}
                </div>
            )}
        </div>
    )
}

// -- Avatar ---
function StreamLoadingBubble() {
    return (
        <div className="flex gap-3" aria-live="polite" aria-label="Assistant is responding">
            <Avatar role="assistant" />
            <div className="flex-1 min-w-0">
                <div className="inline-flex items-center gap-2 rounded-2xl bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1" aria-hidden="true">
                        <span className="w-2 h-2 rounded-full bg-primary/70 animate-bounce [animation-delay:0ms]" />
                        <span className="w-2 h-2 rounded-full bg-primary/70 animate-bounce [animation-delay:150ms]" />
                        <span className="w-2 h-2 rounded-full bg-primary/70 animate-bounce [animation-delay:300ms]" />
                    </span>
                    <span>Generating response…</span>
                </div>
            </div>
        </div>
    )
}

function Avatar({ role }: { role: string }) {
    if (role === 'user') {
        return (
            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold shrink-0">
                U
            </div>
        )
    }
    return (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white text-xs shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 8V4H8" /><rect width="16" height="12" x="4" y="8" rx="2" /><path d="M2 14h2" /><path d="M20 14h2" /><path d="M15 13v2" /><path d="M9 13v2" />
            </svg>
        </div>
    )
}

// -- Copy button --
function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false)

    const handleCopy = useCallback(async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }, [text])

    return (
        <button
            onClick={handleCopy}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            title="Copy message"
        >
            {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                </svg>
            ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
            )}
        </button>
    )
}

// -- Feedback buttons --
function FeedbackButtons({ messageId }: { messageId: string }) {
    const [feedback, setFeedback] = useState<number | null>(null)
    const [showComment, setShowComment] = useState(false)
    const [comment, setComment] = useState('')

    const submitFeedback = useCallback(async (value: number, feedbackComment?: string) => {
        try {
            const response = await fetch('/api/feedback', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    session_id: new URLSearchParams(window.location.search).get('session') || 'default',
                    message_id: messageId,
                    value: value,
                    comment: feedbackComment || null,
                }),
            })

            if (response.ok) {
                setFeedback(value)
                if (showComment) {
                    setShowComment(false)
                    setComment('')
                }
            }
        } catch (error) {
            console.error('Failed to submit feedback:', error)
        }
    }, [messageId, showComment])

    const handleThumbsUp = useCallback(() => {
        if (feedback !== 1) {
            submitFeedback(1)
        }
    }, [feedback, submitFeedback])

    const handleThumbsDown = useCallback(() => {
        if (feedback !== -1) {
            // Submit negative feedback immediately and optionally show comment form
            submitFeedback(-1)
            setShowComment(true)
        } else {
            // Already negative, toggle off comment form
            setShowComment(false)
        }
    }, [feedback, submitFeedback])

    const handleCommentSubmit = useCallback((e: FormEvent) => {
        e.preventDefault()
        submitFeedback(-1, comment)
    }, [comment, submitFeedback])

    return (
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
            <button
                onClick={handleThumbsUp}
                className={`p-1 rounded hover:bg-accent transition-colors ${
                    feedback === 1 ? 'text-green-600' : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Good response"
                disabled={feedback !== null}
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 10v12" />
                    <path d="M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z" />
                </svg>
            </button>
            <button
                onClick={handleThumbsDown}
                className={`p-1 rounded hover:bg-accent transition-colors ${
                    feedback === -1 ? 'text-red-600' : 'text-muted-foreground hover:text-foreground'
                }`}
                title="Poor response"
                disabled={feedback !== null && feedback !== -1}
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 14V2" />
                    <path d="M9 18.12L10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22h0a3.13 3.13 0 0 1-3-3.88Z" />
                </svg>
            </button>
            
            {showComment && (
                <div className="absolute z-10 mt-2 p-2 bg-popover border rounded-md shadow-md min-w-[200px] top-6 left-0">
                    <form onSubmit={handleCommentSubmit} className="space-y-2">
                        <textarea
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            placeholder="What could be better?"
                            className="w-full p-2 text-xs border rounded resize-none"
                            rows={3}
                            autoFocus
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setShowComment(false)
                                    setComment('')
                                }}
                                className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded"
                            >
                                Submit
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    )
}

// -- Markdown renderer --
// Streamdown handles code (Shiki), lists, tables, mermaid, math and the
// incomplete-markdown repair and caret while streaming (markdown/Markdown.tsx).
function MarkdownContent({ content, streaming = false }: { content: string; streaming?: boolean }) {
    return <Markdown variant="chat" streaming={streaming}>{content}</Markdown>
}

// -- Message bubble --
interface MessageBubbleProps {
    message: ChatMessage
    sessionId?: string
}

function MessageBubble({ message, sessionId }: MessageBubbleProps) {
    const isUser = message.role === 'user'

    if (isUser) {
        return (
            <div className="flex justify-end">
                <div className="flex gap-3 max-w-[80%]">
                    <div className="rounded-2xl px-4 py-2.5 bg-primary text-primary-foreground">
                        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    </div>
                    <Avatar role="user" />
                </div>
            </div>
        )
    }

    return (
        <div className="flex gap-3 group">
            <Avatar role="assistant" />
            <div className="flex-1 min-w-0">
                {message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="mb-2 space-y-1">
                        {message.toolCalls.map((tc, i) => (
                            <ToolCallDisplay key={i} toolCall={tc} />
                        ))}
                    </div>
                )}
                <MarkdownContent content={message.content} />
                
                {/* New standardized elements rendering */}
                {message.elements && message.elements.length > 0 && (
                    <div className="mt-3 space-y-3">
                        {message.elements.map((element, i) => (
                            <ElementRenderer 
                                key={i} 
                                element={element} 
                                className="w-full" 
                            />
                        ))}
                    </div>
                )}
                
                {/* Legacy format support for backward compatibility */}
                {message.images && message.images.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                        {message.images.map((url, i) => (
                            <img
                                key={i}
                                src={url}
                                alt=""
                                className="max-w-full rounded-md max-h-64 object-contain"
                            />
                        ))}
                    </div>
                )}
                {/* Action buttons */}
                {message.actions && message.actions.length > 0 && (
                    <ActionButtons 
                        actions={message.actions} 
                        messageId={message.id} 
                        sessionId={sessionId}
                    />
                )}
                <div className="mt-1 flex items-center gap-1 relative">
                    <CopyButton text={message.content} />
                    <FeedbackButtons messageId={message.id} />
                </div>
            </div>
        </div>
    )
}
