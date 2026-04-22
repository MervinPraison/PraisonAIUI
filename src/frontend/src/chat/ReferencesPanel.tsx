import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { ChevronDown, ChevronRight, Copy, Clock } from 'lucide-react'
import { ReferenceData, Reference } from '../types'

interface ReferencesPanelProps {
    references: ReferenceData[]
}

const ReferencesPanel: React.FC<ReferencesPanelProps> = ({ references }) => {
    const [isExpanded, setIsExpanded] = useState(false)
    const [expandedRefs, setExpandedRefs] = useState<Set<string>>(new Set())

    if (!references || references.length === 0) {
        return null
    }

    const totalSources = references.reduce((acc, data) => acc + data.references.length, 0)

    const toggleExpanded = () => {
        setIsExpanded(!isExpanded)
    }

    const toggleReference = (refKey: string) => {
        const newExpanded = new Set(expandedRefs)
        if (newExpanded.has(refKey)) {
            newExpanded.delete(refKey)
        } else {
            newExpanded.add(refKey)
        }
        setExpandedRefs(newExpanded)
    }

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text)
    }

    const truncateText = (text: string, maxLength: number = 300) => {
        if (text.length <= maxLength) return text
        return text.slice(0, maxLength) + '...'
    }

    return (
        <Card className="mt-4 border-l-4 border-l-blue-500">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-sm font-medium">
                    <button
                        onClick={toggleExpanded}
                        className="flex items-center gap-2 text-blue-700 hover:text-blue-800 transition-colors"
                    >
                        {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                        ) : (
                            <ChevronRight className="h-4 w-4" />
                        )}
                        Sources ({totalSources})
                    </button>
                    {references.some(r => r.time_ms) && (
                        <div className="flex items-center gap-1 text-gray-500 text-xs">
                            <Clock className="h-3 w-3" />
                            {Math.max(...references.map(r => r.time_ms || 0)).toFixed(0)}ms
                        </div>
                    )}
                </CardTitle>
            </CardHeader>
            
            {isExpanded && (
                <CardContent className="pt-0 space-y-4">
                    {references.map((refData, refDataIndex) => (
                        <div key={refDataIndex} className="space-y-3">
                            {refData.query && (
                                <div className="bg-gray-50 p-3 rounded-md">
                                    <p className="text-xs text-gray-600 mb-1">Query:</p>
                                    <p className="text-sm font-medium text-gray-800">{refData.query}</p>
                                </div>
                            )}
                            
                            <div className="space-y-2">
                                {refData.references.map((ref, refIndex) => {
                                    const refKey = `${refDataIndex}-${refIndex}`
                                    const isRefExpanded = expandedRefs.has(refKey)
                                    
                                    return (
                                        <div key={refKey} className="border rounded-md overflow-hidden">
                                            <button
                                                onClick={() => toggleReference(refKey)}
                                                className="w-full p-3 text-left bg-gray-50 hover:bg-gray-100 transition-colors"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-medium text-gray-900">
                                                            {ref.name}
                                                        </span>
                                                        {ref.chunk > 0 && (
                                                            <Badge variant="outline" className="text-xs">
                                                                #{ref.chunk}
                                                            </Badge>
                                                        )}
                                                        {ref.chunk_size > 0 && (
                                                            <Badge variant="outline" className="text-xs">
                                                                {ref.chunk_size} chars
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    {isRefExpanded ? (
                                                        <ChevronDown className="h-4 w-4 text-gray-500" />
                                                    ) : (
                                                        <ChevronRight className="h-4 w-4 text-gray-500" />
                                                    )}
                                                </div>
                                            </button>
                                            
                                            {isRefExpanded ? (
                                                <div className="p-3 bg-white border-t">
                                                    <div className="flex justify-between items-start gap-3">
                                                        <div className="flex-1">
                                                            <p className="text-sm text-gray-700 whitespace-pre-wrap">
                                                                {ref.content}
                                                            </p>
                                                        </div>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                copyToClipboard(ref.content)
                                                            }}
                                                            className="flex-shrink-0"
                                                        >
                                                            <Copy className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="p-3 bg-white border-t">
                                                    <p className="text-sm text-gray-600">
                                                        {truncateText(ref.content)}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    ))}
                </CardContent>
            )}
        </Card>
    )
}

export default ReferencesPanel