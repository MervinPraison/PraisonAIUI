import { useEffect, useId, useRef, useState } from 'react'
import { getMermaidConfig, isDarkMode } from './mermaidThemes'

let renderCounter = 0

function nextRenderId(baseId: string): string {
    renderCounter += 1
    return `mermaid-${baseId.replace(/:/g, '')}-${renderCounter}`
}

export function MermaidDiagram({ chart }: { chart: string }) {
    const baseId = useId()
    const svgRef = useRef<HTMLDivElement>(null)
    const bindFunctionsRef = useRef<((element: Element) => void) | undefined>(undefined)
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [errorMessage, setErrorMessage] = useState('')
    const [svgMarkup, setSvgMarkup] = useState('')

    useEffect(() => {
        let cancelled = false

        const render = async () => {
            setStatus('loading')
            setErrorMessage('')
            setSvgMarkup('')
            const mermaid = (await import('mermaid')).default
            mermaid.initialize(getMermaidConfig(isDarkMode()))

            try {
                const { svg, bindFunctions } = await mermaid.render(nextRenderId(baseId), chart)
                if (cancelled) return
                bindFunctionsRef.current = bindFunctions
                setSvgMarkup(svg)
                setStatus('ready')
            } catch (err) {
                if (cancelled) return
                setStatus('error')
                setErrorMessage(err instanceof Error ? err.message : 'Failed to render diagram')
            }
        }

        void render()

        const observer = new MutationObserver(() => {
            void render()
        })
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class'],
        })

        return () => {
            cancelled = true
            observer.disconnect()
        }
    }, [chart, baseId])

    useEffect(() => {
        if (status !== 'ready' || !svgRef.current) return
        bindFunctionsRef.current?.(svgRef.current)
    }, [status, svgMarkup])

    if (status === 'error') {
        return (
            <pre className="mermaid-diagram mermaid-error text-destructive text-sm my-4 p-4 rounded-lg border border-destructive/30 bg-destructive/5 overflow-x-auto">
                {errorMessage}
            </pre>
        )
    }

    return (
        <div
            className={`mermaid-diagram my-4 overflow-x-auto${status === 'loading' ? ' mermaid-loading text-muted-foreground text-sm' : ''}`}
            aria-busy={status === 'loading'}
            aria-label={status === 'loading' ? 'Loading diagram' : 'Mermaid diagram'}
        >
            {status === 'loading' ? 'Loading diagram…' : null}
            {svgMarkup ? (
                <div ref={svgRef} dangerouslySetInnerHTML={{ __html: svgMarkup }} />
            ) : null}
        </div>
    )
}
