import { useState, useCallback, useRef, type KeyboardEvent } from 'react'

interface ChatInputProps {
    onSend: (message: string) => void
    onCancel?: () => void
    isStreaming?: boolean
    placeholder?: string
    enableFileUpload?: boolean
}

export function ChatInput({
    onSend,
    onCancel,
    isStreaming = false,
    placeholder = 'Type a message...',
    enableFileUpload = false,
}: ChatInputProps) {
    const [input, setInput] = useState('')
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const handleSend = useCallback(() => {
        const trimmed = input.trim()
        if (trimmed && !isStreaming) {
            onSend(trimmed)
            setInput('')
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto'
            }
        }
    }, [input, isStreaming, onSend])

    const handleKeyDown = useCallback(
        (e: KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
            }
        },
        [handleSend]
    )

    const handleInput = useCallback(() => {
        const textarea = textareaRef.current
        if (textarea) {
            textarea.style.height = 'auto'
            textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
        }
    }, [])

    return (
        <div className="border-t p-4 bg-background">
            <div className="flex items-end gap-2 max-w-4xl mx-auto">
                {enableFileUpload && (
                    <button
                        type="button"
                        className="p-2 rounded-md hover:bg-accent text-muted-foreground"
                        title="Attach file"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                        </svg>
                    </button>
                )}
                <div className="flex-1 relative">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onInput={handleInput}
                        placeholder={placeholder}
                        disabled={isStreaming}
                        rows={1}
                        className="w-full resize-none rounded-lg border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                        style={{ maxHeight: '200px' }}
                    />
                </div>
                {isStreaming ? (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="p-2 rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        title="Stop"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                        >
                            <rect x="6" y="6" width="12" height="12" rx="2" />
                        </svg>
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={handleSend}
                        disabled={!input.trim()}
                        className="p-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                        title="Send"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="m22 2-7 20-4-9-9-4Z" />
                            <path d="M22 2 11 13" />
                        </svg>
                    </button>
                )}
            </div>
        </div>
    )
}
