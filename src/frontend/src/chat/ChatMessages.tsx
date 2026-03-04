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
        <div className="space-y-4">
            {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
            ))}
            {isStreaming && (
                <div className="space-y-2">
                    {thinkingSteps.length > 0 && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground px-4 py-1">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                            <span>{thinkingSteps[thinkingSteps.length - 1]}</span>
                        </div>
                    )}
                    {toolCalls.length > 0 && (
                        <div className="space-y-1">
                            {toolCalls.map((tc, i) => (
                                <ToolCallDisplay key={i} toolCall={tc} />
                            ))}
                        </div>
                    )}
                    {currentResponse && (
                        <div className="flex justify-start">
                            <div className="max-w-[80%] rounded-lg px-4 py-2 bg-muted">
                                <p className="text-sm whitespace-pre-wrap">{currentResponse}</p>
                                <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

interface MessageBubbleProps {
    message: ChatMessage
}

function MessageBubble({ message }: MessageBubbleProps) {
    const isUser = message.role === 'user'

    return (
        <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${isUser
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                    }`}
            >

                {message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="mb-2 space-y-1">
                        {message.toolCalls.map((tc, i) => (
                            <ToolCallDisplay key={i} toolCall={tc} />
                        ))}
                    </div>
                )}
                <p className="text-sm whitespace-pre-wrap">{message.content}</p>
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
                    <div className="mt-2 flex flex-wrap gap-2">
                        {message.actions.map((action) => (
                            <button
                                key={action.name}
                                className="px-3 py-1 text-xs rounded-md bg-background border hover:bg-accent"
                            >
                                {action.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
