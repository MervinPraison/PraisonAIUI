import { useState, useCallback, useRef, useEffect, type MouseEvent } from 'react'

interface MessageElement {
    type: 'image' | 'pdf' | 'video' | 'audio' | 'file' | 'code'
    url?: string
    content?: string
    name?: string
}

interface BoundingBox {
    x: number
    y: number
    width: number
    height: number
}

interface Point {
    x: number
    y: number
}

interface AskElementPromptProps {
    element: MessageElement
    prompt: string
    returnType: 'annotation' | 'bbox' | 'point' | 'freeform'
    timeout: number
    onSubmit: (payload: any) => void
    onTimeout: () => void
}

export function AskElementPrompt({
    element,
    prompt,
    returnType,
    timeout,
    onSubmit,
    onTimeout,
}: AskElementPromptProps) {
    const [timeLeft, setTimeLeft] = useState(timeout)
    const [isDrawing, setIsDrawing] = useState(false)
    const [startPoint, setStartPoint] = useState<Point | null>(null)
    const [currentBox, setCurrentBox] = useState<BoundingBox | null>(null)
    const [selectedPoint, setSelectedPoint] = useState<Point | null>(null)
    const [annotations, setAnnotations] = useState<any[]>([])
    const containerRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)

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

    // Update canvas size when container changes
    useEffect(() => {
        const updateCanvasSize = () => {
            if (containerRef.current && canvasRef.current) {
                const rect = containerRef.current.getBoundingClientRect()
                canvasRef.current.width = rect.width
                canvasRef.current.height = rect.height
            }
        }

        updateCanvasSize()
        window.addEventListener('resize', updateCanvasSize)
        return () => window.removeEventListener('resize', updateCanvasSize)
    }, [])

    const getRelativeCoordinates = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
        if (!canvasRef.current) return { x: 0, y: 0 }
        
        const rect = canvasRef.current.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        
        // Convert to relative coordinates (0-1)
        return {
            x: x / rect.width,
            y: y / rect.height,
        }
    }, [])

    const handleMouseDown = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
        const point = getRelativeCoordinates(e)
        
        if (returnType === 'point') {
            setSelectedPoint(point)
        } else if (returnType === 'bbox') {
            setIsDrawing(true)
            setStartPoint(point)
            setCurrentBox(null)
        }
    }, [getRelativeCoordinates, returnType])

    const handleMouseMove = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
        if (!isDrawing || !startPoint || returnType !== 'bbox') return
        
        const currentPoint = getRelativeCoordinates(e)
        const box: BoundingBox = {
            x: Math.min(startPoint.x, currentPoint.x),
            y: Math.min(startPoint.y, currentPoint.y),
            width: Math.abs(currentPoint.x - startPoint.x),
            height: Math.abs(currentPoint.y - startPoint.y),
        }
        
        setCurrentBox(box)
    }, [isDrawing, startPoint, getRelativeCoordinates, returnType])

    const handleMouseUp = useCallback(() => {
        if (returnType === 'bbox' && currentBox && currentBox.width > 0.01 && currentBox.height > 0.01) {
            // Valid bounding box drawn
            setIsDrawing(false)
            setStartPoint(null)
        } else {
            // Reset if box is too small
            setIsDrawing(false)
            setStartPoint(null)
            setCurrentBox(null)
        }
    }, [returnType, currentBox])

    const handleSubmit = useCallback(() => {
        let payload: any = {}
        
        switch (returnType) {
            case 'point':
                if (!selectedPoint) {
                    alert('Please click on the element to select a point')
                    return
                }
                payload = { point: selectedPoint }
                break
                
            case 'bbox':
                if (!currentBox) {
                    alert('Please draw a bounding box on the element')
                    return
                }
                payload = { bbox: currentBox }
                break
                
            case 'annotation':
                payload = { annotations }
                break
                
            case 'freeform':
                payload = { 
                    point: selectedPoint,
                    bbox: currentBox,
                    annotations 
                }
                break
        }
        
        onSubmit(payload)
    }, [returnType, selectedPoint, currentBox, annotations, onSubmit])

    const handleReset = useCallback(() => {
        setSelectedPoint(null)
        setCurrentBox(null)
        setAnnotations([])
        setIsDrawing(false)
        setStartPoint(null)
    }, [])

    const formatTime = useCallback((seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = seconds % 60
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }, [])

    // Render the element
    const renderElement = () => {
        switch (element.type) {
            case 'image':
                return (
                    <img
                        src={element.url}
                        alt={element.name || 'Element'}
                        className="max-w-full max-h-96 object-contain"
                        draggable={false}
                    />
                )
            case 'video':
                return (
                    <video
                        src={element.url}
                        className="max-w-full max-h-96"
                        controls
                    />
                )
            default:
                return (
                    <div className="p-8 bg-gray-100 rounded text-center text-gray-600">
                        Element type "{element.type}" not supported for interaction
                    </div>
                )
        }
    }

    const canSubmit = () => {
        switch (returnType) {
            case 'point':
                return selectedPoint !== null
            case 'bbox':
                return currentBox !== null
            default:
                return true
        }
    }

    return (
        <div className="ask-element-prompt max-w-2xl mx-auto bg-white border border-gray-200 rounded-lg p-6 shadow-lg">
            <h3 className="text-lg font-medium text-gray-900 mb-2">{prompt}</h3>
            <p className="text-sm text-gray-600 mb-4">
                {returnType === 'point' && 'Click to select a point'}
                {returnType === 'bbox' && 'Click and drag to draw a bounding box'}
                {returnType === 'annotation' && 'Add annotations as needed'}
                {returnType === 'freeform' && 'Interact with the element as desired'}
            </p>
            
            {/* Timeout indicator */}
            <div className="mb-4 text-center">
                <div className="text-sm text-gray-500 mb-2">
                    Time remaining: {formatTime(timeLeft)}
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                    <div 
                        className="bg-blue-600 h-2 rounded-full transition-all duration-1000"
                        style={{ width: `${(timeLeft / timeout) * 100}%` }}
                    />
                </div>
            </div>

            {/* Interactive element container */}
            <div 
                ref={containerRef}
                className="relative bg-gray-50 rounded-lg p-4 mb-4 inline-block max-w-full"
            >
                {renderElement()}
                
                {/* Overlay canvas for interactions */}
                <canvas
                    ref={canvasRef}
                    className="absolute top-4 left-4 cursor-crosshair"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    style={{
                        background: 'transparent',
                        pointerEvents: element.type === 'image' || element.type === 'video' ? 'auto' : 'none'
                    }}
                />
                
                {/* Visual feedback for selections */}
                {selectedPoint && returnType === 'point' && (
                    <div
                        className="absolute w-3 h-3 bg-red-500 border-2 border-white rounded-full transform -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                        style={{
                            left: `${selectedPoint.x * 100}%`,
                            top: `${selectedPoint.y * 100}%`,
                        }}
                    />
                )}
                
                {currentBox && returnType === 'bbox' && (
                    <div
                        className="absolute border-2 border-blue-500 bg-blue-200 bg-opacity-30 pointer-events-none"
                        style={{
                            left: `${currentBox.x * 100}%`,
                            top: `${currentBox.y * 100}%`,
                            width: `${currentBox.width * 100}%`,
                            height: `${currentBox.height * 100}%`,
                        }}
                    />
                )}
            </div>

            {/* Status display */}
            {selectedPoint && (
                <div className="mb-4 text-sm text-gray-600">
                    Selected point: ({selectedPoint.x.toFixed(3)}, {selectedPoint.y.toFixed(3)})
                </div>
            )}
            
            {currentBox && (
                <div className="mb-4 text-sm text-gray-600">
                    Bounding box: x={currentBox.x.toFixed(3)}, y={currentBox.y.toFixed(3)}, 
                    w={currentBox.width.toFixed(3)}, h={currentBox.height.toFixed(3)}
                </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canSubmit()}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                    Submit
                </button>
                <button
                    type="button"
                    onClick={handleReset}
                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 transition-colors"
                >
                    Reset
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