import { useState, useCallback, useRef, type KeyboardEvent, type ChangeEvent } from 'react'

interface ChatInputProps {
    onSend: (message: string, files?: File[]) => void
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
    const [files, setFiles] = useState<File[]>([])
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleSend = useCallback(() => {
        const trimmed = input.trim()
        if ((trimmed || files.length > 0) && !isStreaming) {
            onSend(trimmed, files.length > 0 ? files : undefined)
            setInput('')
            setFiles([])
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto'
            }
        }
    }, [input, files, isStreaming, onSend])

    const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = Array.from(e.target.files || [])
        setFiles((prev) => [...prev, ...selectedFiles])
        if (fileInputRef.current) {
            fileInputRef.current.value = ''
        }
    }, [])

    const handleFileClick = useCallback(() => {
        fileInputRef.current?.click()
    }, [])

    const removeFile = useCallback((index: number) => {
        setFiles((prev) => prev.filter((_, i) => i !== index))
    }, [])

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
        <div className="p-4 pb-6">
            <div className="max-w-3xl mx-auto">
                <div className="rounded-2xl border bg-background/80 backdrop-blur-sm shadow-lg">
                    {/* File preview chips */}
                    {files.length > 0 && (
                        <div className="flex flex-wrap gap-1 px-4 pt-3">
                            {files.map((file, index) => (
                                <span
                                    key={`${file.name}-${index}`}
                                    className="inline-flex items-center gap-1 px-2 py-1 bg-muted rounded-lg text-xs"
                                >
                                    <span className="truncate max-w-[100px]">{file.name}</span>
                                    <button
                                        type="button"
                                        onClick={() => removeFile(index)}
                                        className="hover:text-destructive"
                                    >
                                        ×
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                    <div className="flex items-end gap-2 p-2">
                        {enableFileUpload && (
                            <>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    onChange={handleFileChange}
                                    className="hidden"
                                    accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.txt,.csv,.json"
                                />
                                <button
                                    type="button"
                                    onClick={handleFileClick}
                                    className="p-2 rounded-xl hover:bg-accent text-muted-foreground transition-colors"
                                    title="Attach file"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                                    </svg>
                                </button>
                            </>
                        )}
                        <textarea
                            ref={textareaRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onInput={handleInput}
                            placeholder={placeholder}
                            disabled={isStreaming}
                            rows={1}
                            className="flex-1 resize-none bg-transparent px-3 py-2.5 text-sm focus:outline-none disabled:opacity-50 placeholder:text-muted-foreground/60"
                            style={{ maxHeight: '200px' }}
                        />
                        {isStreaming ? (
                            <button
                                type="button"
                                onClick={onCancel}
                                className="p-2 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                                title="Stop"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                    <rect x="6" y="6" width="12" height="12" rx="2" />
                                </svg>
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={handleSend}
                                disabled={!input.trim()}
                                className="p-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                title="Send"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M5 12h14M12 5l7 7-7 7" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>
                <p className="text-[10px] text-center text-muted-foreground/50 mt-2">
                    Press Enter to send, Shift+Enter for new line
                </p>
            </div>
        </div>
    )
}
