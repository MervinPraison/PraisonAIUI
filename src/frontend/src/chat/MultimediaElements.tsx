import { useState } from 'react'
import type { MessageElementUnion, ImageElement, PdfElement, VideoElement, AudioElement, FileElement, CodeElement } from '../types'

interface ImageElementProps {
    url: string
    alt?: string
    className?: string
    display?: 'inline' | 'side' | 'page'
    width?: number
    height?: number
}

export function ImageElement({ url, alt = '', className = '', display = 'inline', width, height }: ImageElementProps) {
    const [loaded, setLoaded] = useState(false)
    const [error, setError] = useState(false)
    const [zoomed, setZoomed] = useState(false)

    if (error) {
        return (
            <div className={`flex items-center justify-center bg-muted rounded-md p-4 ${className}`}>
                <span className="text-muted-foreground text-sm">Failed to load image</span>
            </div>
        )
    }

    const maxHeight = display === 'side' ? 'max-h-64' : display === 'page' ? 'max-h-screen' : 'max-h-96'

    return (
        <>
            <div className={`relative cursor-pointer ${className}`} onClick={() => setZoomed(true)}>
                {!loaded && (
                    <div className="absolute inset-0 flex items-center justify-center bg-muted rounded-md animate-pulse">
                        <span className="text-muted-foreground text-sm" aria-live="polite">Loading image...</span>
                    </div>
                )}
                <img
                    src={url}
                    alt={alt || 'Image'}
                    onLoad={() => setLoaded(true)}
                    onError={() => setError(true)}
                    className={`max-w-full rounded-md ${maxHeight} object-contain transition-transform hover:scale-105 ${loaded ? '' : 'invisible'}`}
                    style={width || height ? { width, height } : undefined}
                    role="img"
                    aria-label={alt || 'Click to enlarge image'}
                />
                {loaded && (
                    <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded opacity-0 hover:opacity-100 transition-opacity">
                        Click to zoom
                    </div>
                )}
            </div>

            {/* Zoom overlay */}
            {zoomed && (
                <div 
                    className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
                    onClick={() => setZoomed(false)}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Image zoom view"
                >
                    <div className="relative max-w-full max-h-full">
                        <img
                            src={url}
                            alt={alt || 'Zoomed image'}
                            className="max-w-full max-h-full object-contain"
                            role="img"
                        />
                        <button
                            className="absolute top-4 right-4 bg-white/20 hover:bg-white/30 text-white p-2 rounded-full transition-colors"
                            onClick={(e) => {
                                e.stopPropagation()
                                setZoomed(false)
                            }}
                            aria-label="Close zoom view"
                        >
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </div>
            )}
        </>
    )
}

interface PdfElementProps {
    url: string
    name?: string
    className?: string
    display?: 'inline' | 'side' | 'page'
}

export function PdfElement({ url, name, className = '', display = 'inline' }: PdfElementProps) {
    const [error, setError] = useState(false)

    if (error) {
        return (
            <div className={`flex items-center justify-center bg-muted rounded-md p-4 ${className}`}>
                <span className="text-muted-foreground text-sm">Failed to load PDF</span>
            </div>
        )
    }

    // For page display mode, open in a new tab
    if (display === 'page') {
        return (
            <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-3 p-3 rounded-md border bg-card hover:bg-accent transition-colors ${className}`}
            >
                <span className="text-2xl">📄</span>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{name || 'PDF Document'}</p>
                    <p className="text-xs text-muted-foreground">Click to open in new tab</p>
                </div>
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-muted-foreground"
                >
                    <path d="M7 7h10v10" />
                    <path d="m7 17 10-10" />
                </svg>
            </a>
        )
    }

    // For inline/side display, embed PDF viewer
    const height = display === 'side' ? '400px' : '600px'
    
    return (
        <div className={`rounded-md overflow-hidden ${className}`}>
            {name && (
                <div className="px-3 py-2 bg-muted border-b text-sm font-medium">
                    📄 {name}
                </div>
            )}
            <iframe
                src={`${url}#toolbar=1&navpanes=1&scrollbar=1`}
                width="100%"
                height={height}
                style={{ border: 'none' }}
                onError={() => setError(true)}
                title={name || 'PDF Document'}
            />
        </div>
    )
}

interface AudioElementProps {
    url: string
    className?: string
}

export function AudioElement({ url, className = '' }: AudioElementProps) {
    return (
        <div className={`${className}`}>
            <audio controls className="w-full max-w-md">
                <source src={url} />
                Your browser does not support the audio element.
            </audio>
        </div>
    )
}

interface VideoElementProps {
    url: string
    className?: string
}

export function VideoElement({ url, className = '' }: VideoElementProps) {
    return (
        <div className={`${className}`}>
            <video controls className="w-full max-w-lg rounded-md">
                <source src={url} />
                Your browser does not support the video element.
            </video>
        </div>
    )
}

interface FileElementProps {
    url: string
    name: string
    size?: number
    type?: string
    className?: string
}

export function FileElement({ url, name, size, type, className = '' }: FileElementProps) {
    const formatSize = (bytes?: number) => {
        if (!bytes) return ''
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    const getIcon = () => {
        if (type?.startsWith('image/')) return '🖼️'
        if (type?.startsWith('video/')) return '🎬'
        if (type?.startsWith('audio/')) return '🎵'
        if (type?.includes('pdf')) return '📄'
        if (type?.includes('zip') || type?.includes('tar') || type?.includes('rar')) return '📦'
        if (type?.includes('text') || type?.includes('document')) return '📝'
        return '📎'
    }

    return (
        <a
            href={url}
            download={name}
            className={`flex items-center gap-3 p-3 rounded-md border bg-card hover:bg-accent transition-colors ${className}`}
        >
            <span className="text-2xl">{getIcon()}</span>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{name}</p>
                {(size || type) && (
                    <p className="text-xs text-muted-foreground">
                        {[formatSize(size), type].filter(Boolean).join(' • ')}
                    </p>
                )}
            </div>
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-muted-foreground"
            >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" x2="12" y1="15" y2="3" />
            </svg>
        </a>
    )
}

interface CodeBlockProps {
    code: string
    language?: string
    className?: string
}

export function CodeBlock({ code, language, className = '' }: CodeBlockProps) {
    const [copied, setCopied] = useState(false)

    const handleCopy = async () => {
        await navigator.clipboard.writeText(code)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    return (
        <div className={`relative rounded-md bg-muted ${className}`}>
            <div className="flex items-center justify-between px-3 py-1 border-b bg-muted/50">
                <span className="text-xs text-muted-foreground">{language || 'code'}</span>
                <button
                    onClick={handleCopy}
                    className="text-xs text-muted-foreground hover:text-foreground"
                >
                    {copied ? 'Copied!' : 'Copy'}
                </button>
            </div>
            <pre className="p-3 overflow-x-auto text-sm">
                <code>{code}</code>
            </pre>
        </div>
    )
}

// Unified element renderer supporting all element types and display modes
interface ElementRendererProps {
    element: MessageElementUnion | Record<string, unknown>
    className?: string
}

export function ElementRenderer({ element, className = '' }: ElementRendererProps) {
    // Type guard to check if element has required properties
    const hasType = element && typeof element === 'object' && 'type' in element
    if (!hasType) return null

    const elementType = element.type as string

    try {
        switch (elementType) {
            case 'image': {
                const img = element as ImageElement
                return (
                    <ImageElement
                        url={img.url}
                        alt={img.alt}
                        className={`${className} ${getDisplayModeClass(img.display)}`}
                    />
                )
            }
            case 'pdf': {
                const pdf = element as PdfElement
                return (
                    <PdfElement
                        url={pdf.url}
                        name={pdf.name}
                        display={pdf.display}
                        className={`${className} ${getDisplayModeClass(pdf.display)}`}
                    />
                )
            }
            case 'video': {
                const video = element as VideoElement
                return (
                    <VideoElement
                        url={video.url}
                        className={`${className} ${getDisplayModeClass(video.display)}`}
                    />
                )
            }
            case 'audio': {
                const audio = element as AudioElement
                return (
                    <AudioElement
                        url={audio.url}
                        className={`${className} ${getDisplayModeClass(audio.display)}`}
                    />
                )
            }
            case 'file': {
                const file = element as FileElement
                return (
                    <FileElement
                        url={file.url}
                        name={file.name || 'File'}
                        size={file.size}
                        type={file.mimeType}
                        className={`${className} ${getDisplayModeClass(file.display)}`}
                    />
                )
            }
            case 'code': {
                const code = element as CodeElement
                return (
                    <CodeBlock
                        code={code.content}
                        language={code.language}
                        className={`${className} ${getDisplayModeClass(code.display)}`}
                    />
                )
            }
            default:
                // Fallback for legacy/unknown element types
                if ('url' in element && typeof element.url === 'string') {
                    if (elementType === 'image') {
                        return <ImageElement url={element.url} className={className} />
                    } else if (elementType === 'video') {
                        return <VideoElement url={element.url} className={className} />
                    } else if (elementType === 'audio') {
                        return <AudioElement url={element.url} className={className} />
                    } else {
                        const name = ('name' in element && typeof element.name === 'string') ? element.name : 'File'
                        return <FileElement url={element.url} name={name} className={className} />
                    }
                }
                return null
        }
    } catch (error) {
        console.warn('Error rendering element:', error)
        return (
            <div className={`flex items-center justify-center bg-muted rounded-md p-4 ${className}`}>
                <span className="text-muted-foreground text-sm">Failed to render element</span>
            </div>
        )
    }
}

// Helper function to get CSS classes based on display mode
function getDisplayModeClass(display?: string): string {
    switch (display) {
        case 'side':
            return 'max-w-sm'
        case 'page':
            return 'w-full'
        case 'inline':
        default:
            return 'max-w-full'
    }
}
