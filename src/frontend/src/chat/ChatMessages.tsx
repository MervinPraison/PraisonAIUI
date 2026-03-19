import { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { ChatMessage, ToolCall } from '../types'
import { ToolCallDisplay } from './ToolCallDisplay'

interface ChatMessagesProps {
    messages: ChatMessage[]
    currentResponse: string
    thinkingSteps: string[]
    toolCalls: ToolCall[]
    isStreaming: boolean
}

export function ChatMessages({
    messages,
    currentResponse,
    thinkingSteps,
    toolCalls,
    isStreaming,
}: ChatMessagesProps) {
    return (
        <div className="max-w-3xl mx-auto space-y-6">
            {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
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
                    {currentResponse && (
                        <div className="flex gap-3">
                            <Avatar role="assistant" />
                            <div className="flex-1 min-w-0">
                                <MarkdownContent content={currentResponse} />
                                <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-0.5 rounded-sm" />
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// -- Avatar ---
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

// -- Code block with copy --
function CodeBlock({ language, children }: { language?: string; children: string }) {
    const [copied, setCopied] = useState(false)

    const handleCopy = useCallback(async () => {
        await navigator.clipboard.writeText(children)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }, [children])

    return (
        <div className="relative group/code my-3 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-1.5 bg-[#1e1e2e] text-xs text-gray-400">
                <span>{language || 'code'}</span>
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1 hover:text-white transition-colors"
                >
                    {copied ? '✓ Copied' : 'Copy'}
                </button>
            </div>
            <SyntaxHighlighter
                style={oneDark}
                language={language || 'text'}
                PreTag="div"
                customStyle={{ margin: 0, borderRadius: 0, fontSize: '13px' }}
            >
                {children}
            </SyntaxHighlighter>
        </div>
    )
}

// -- Markdown renderer --
function MarkdownContent({ content }: { content: string }) {
    return (
        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0 prose-pre:bg-transparent">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    // Ordered list: explicit decimal counter so items show 1. 2. 3.
                    ol({ children }) {
                        return (
                            <ol style={{ listStyleType: 'decimal', paddingLeft: '1.5rem', margin: '0.5rem 0' }}>
                                {children}
                            </ol>
                        )
                    },
                    // Unordered list
                    ul({ children }) {
                        return (
                            <ul style={{ listStyleType: 'disc', paddingLeft: '1.5rem', margin: '0.5rem 0' }}>
                                {children}
                            </ul>
                        )
                    },
                    // List item: display:list-item so the browser uses the parent counter
                    li({ children }) {
                        return (
                            <li style={{ display: 'list-item', marginBottom: '0.25rem' }}>
                                {children}
                            </li>
                        )
                    },
                    code({ className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || '')
                        const codeString = String(children).replace(/\n$/, '')

                        // Inline code
                        if (!match && !codeString.includes('\n')) {
                            return (
                                <code className="px-1.5 py-0.5 rounded bg-muted text-sm font-mono" {...props}>
                                    {children}
                                </code>
                            )
                        }

                        // Code block
                        return <CodeBlock language={match?.[1]}>{codeString}</CodeBlock>
                    },
                    a({ href, children }) {
                        return (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                {children}
                            </a>
                        )
                    },
                    table({ children }) {
                        return (
                            <div className="overflow-x-auto my-3">
                                <table className="min-w-full text-sm">{children}</table>
                            </div>
                        )
                    },
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    )
}

// -- Message bubble --
interface MessageBubbleProps {
    message: ChatMessage
}

function MessageBubble({ message }: MessageBubbleProps) {
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
                {message.actions && message.actions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {message.actions.map((action) => (
                            <button
                                key={action.name}
                                className="px-3 py-1.5 text-xs rounded-lg bg-background border hover:bg-accent transition-colors"
                            >
                                {action.label}
                            </button>
                        ))}
                    </div>
                )}
                <div className="mt-1 flex items-center gap-1">
                    <CopyButton text={message.content} />
                </div>
            </div>
        </div>
    )
}
