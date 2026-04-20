import { useState, useCallback, useRef, useEffect, type DragEvent, type ChangeEvent } from 'react'

interface FileUploadConfig {
    accept: string[]
    maxSizeMb: number
    maxFiles: number
}

interface AskFilePromptProps {
    content: string
    config: FileUploadConfig
    timeout: number
    onSubmit: (files: File[]) => void
    onTimeout: () => void
}

export function AskFilePrompt({
    content,
    config,
    timeout,
    onSubmit,
    onTimeout,
}: AskFilePromptProps) {
    const [files, setFiles] = useState<File[]>([])
    const [dragOver, setDragOver] = useState(false)
    const [error, setError] = useState<string>('')
    const [timeLeft, setTimeLeft] = useState(timeout)
    const fileInputRef = useRef<HTMLInputElement>(null)

    // Timeout countdown
    useEffect(() => {
        const interval = setInterval(() => {
            setTimeLeft((prev) => {
                if (prev <= 1) {
                    clearInterval(interval)
                    onTimeout()
                    return 0
                }
                return prev - 1
            })
        }, 1000)

        return () => clearInterval(interval)
    }, [onTimeout])

    const validateFiles = useCallback((fileList: File[]): File[] => {
        const maxSizeBytes = config.maxSizeMb * 1024 * 1024
        const validFiles: File[] = []
        let errorMsg = ''

        if (fileList.length + files.length > config.maxFiles) {
            errorMsg = `Maximum ${config.maxFiles} files allowed`
        } else {
            for (const file of fileList) {
                // Check file size
                if (file.size > maxSizeBytes) {
                    errorMsg = `File "${file.name}" exceeds maximum size of ${config.maxSizeMb}MB`
                    break
                }

                // Check file type if accept filter is specified
                if (config.accept.length > 0) {
                    const extension = '.' + file.name.split('.').pop()?.toLowerCase()
                    const mimeType = file.type.toLowerCase()
                    
                    const isAccepted = config.accept.some(accept => 
                        accept === extension || 
                        accept === mimeType ||
                        (accept.endsWith('/*') && mimeType.startsWith(accept.slice(0, -1)))
                    )
                    
                    if (!isAccepted) {
                        errorMsg = `File type "${extension}" not accepted. Allowed: ${config.accept.join(', ')}`
                        break
                    }
                }

                validFiles.push(file)
            }
        }

        setError(errorMsg)
        return validFiles
    }, [config, files.length])

    const handleFileSelect = useCallback((fileList: FileList | null) => {
        if (!fileList) return
        
        const newFiles = validateFiles(Array.from(fileList))
        if (newFiles.length > 0) {
            setFiles(prev => [...prev, ...newFiles])
        }
    }, [validateFiles])

    const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        setDragOver(false)
        handleFileSelect(e.dataTransfer.files)
    }, [handleFileSelect])

    const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        setDragOver(true)
    }, [])

    const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
        e.preventDefault()
        setDragOver(false)
    }, [])

    const handleInputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
        handleFileSelect(e.target.files)
        if (fileInputRef.current) {
            fileInputRef.current.value = ''
        }
    }, [handleFileSelect])

    const handleBrowseClick = useCallback(() => {
        fileInputRef.current?.click()
    }, [])

    const removeFile = useCallback((index: number) => {
        setFiles(prev => prev.filter((_, i) => i !== index))
        setError('')
    }, [])

    const handleSubmit = useCallback(() => {
        if (files.length === 0) {
            setError('Please select at least one file')
            return
        }
        onSubmit(files)
    }, [files, onSubmit])

    const acceptAttr = config.accept.length > 0 ? config.accept.join(',') : undefined

    return (
        <div className="ask-file-prompt max-w-md mx-auto bg-white border border-gray-200 rounded-lg p-6 shadow-lg">
            <h3 className="text-lg font-medium text-gray-900 mb-4">{content}</h3>
            
            {/* Timeout indicator */}
            <div className="mb-4 text-sm text-gray-500 text-center">
                Time remaining: {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
            </div>

            {/* Drag & Drop Zone */}
            <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                    dragOver 
                        ? 'border-blue-400 bg-blue-50' 
                        : 'border-gray-300 hover:border-gray-400'
                }`}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
            >
                <div className="text-gray-600">
                    <p className="mb-2">Drag & drop files here</p>
                    <p className="text-sm mb-4">or</p>
                    <button
                        type="button"
                        onClick={handleBrowseClick}
                        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                    >
                        Browse Files
                    </button>
                </div>
                
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple={config.maxFiles > 1}
                    accept={acceptAttr}
                    onChange={handleInputChange}
                    className="hidden"
                />
            </div>

            {/* File constraints */}
            {(config.accept.length > 0 || config.maxSizeMb > 0) && (
                <div className="mt-3 text-sm text-gray-500">
                    {config.accept.length > 0 && (
                        <p>Accepted types: {config.accept.join(', ')}</p>
                    )}
                    <p>Max size: {config.maxSizeMb}MB per file, {config.maxFiles} files max</p>
                </div>
            )}

            {/* Error message */}
            {error && (
                <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                    {error}
                </div>
            )}

            {/* Selected files */}
            {files.length > 0 && (
                <div className="mt-4">
                    <h4 className="text-sm font-medium text-gray-700 mb-2">Selected files:</h4>
                    <ul className="space-y-1">
                        {files.map((file, index) => (
                            <li key={index} className="flex items-center justify-between text-sm bg-gray-50 rounded p-2">
                                <span className="truncate">
                                    {file.name} ({(file.size / 1024 / 1024).toFixed(1)}MB)
                                </span>
                                <button
                                    type="button"
                                    onClick={() => removeFile(index)}
                                    className="text-red-600 hover:text-red-800 ml-2"
                                >
                                    ×
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Action buttons */}
            <div className="mt-6 flex gap-3">
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={files.length === 0}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                    Upload {files.length > 0 ? `${files.length} file${files.length > 1 ? 's' : ''}` : ''}
                </button>
                <button
                    type="button"
                    onClick={onTimeout}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors"
                >
                    Cancel
                </button>
            </div>
        </div>
    )
}