import { useState } from 'react'

interface ImageElementProps {
    url: string
    alt?: string
    className?: string
}

export function ImageElement({ url, alt = '', className = '' }: ImageElementProps) {
    const [loaded, setLoaded] = useState(false)
    const [error, setError] = useState(false)

    if (error) {
        return (
            <div className={`flex items-center justify-center bg-muted rounded-md p-4 ${className}`}>
                <span className="text-muted-foreground text-sm">Failed to load image</span>
            </div>
        )
    }

    return (
        <div className={`relative ${className}`}>
            {!loaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted rounded-md animate-pulse">
                    <span className="text-muted-foreground text-sm">Loading...</span>
                </div>
            )}
            <img
                src={url}
                alt={alt}
                onLoad={() => setLoaded(true)}
                onError={() => setError(true)}
                className={`max-w-full rounded-md max-h-96 object-contain ${loaded ? '' : 'invisible'}`}
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
