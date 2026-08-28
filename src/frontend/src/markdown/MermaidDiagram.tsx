import { useEffect, useId, useRef, useState } from 'react'
import { fitMermaidSvg, getMermaidConfig, isDarkMode } from './mermaidThemes'

let renderCounter = 0

function nextRenderId(baseId: string): string {
    renderCounter += 1
    return `mermaid-${baseId.replace(/:/g, '')}-${renderCounter}`
}

export function MermaidDiagram({ chart }: { chart: string }) {
    const baseId = useId()
    const containerRef = useRef<HTMLDivElement>(null)
    const svgRef = useRef<HTMLDivElement>(null)
    const bindFunctionsRef = useRef<((element: Element) => void) | undefined>(undefined)
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [errorMessage, setErrorMessage] = useState('')
    const [svgMarkup, setSvgMarkup] = useState('')

    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        let cancelled = false

        const render = async () => {
            setStatus('loading')
            setErrorMessage('')
            setSvgMarkup('')
            const mermaid = (await import('mermaid')).default
            mermaid.initialize(getMermaidConfig(isDarkMode()))

            const styles = getComputedStyle(container)
            const paddingX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight)
            const containerWidth = container.clientWidth - paddingX

            try {
                const { svg, bindFunctions } = await mermaid.render(nextRenderId(baseId), chart)
                if (cancelled) return
                bindFunctionsRef.current = bindFunctions
                setSvgMarkup(fitMermaidSvg(svg, containerWidth))
                setStatus('ready')
            } catch (err) {
                if (cancelled) return
                setStatus('error')
                setErrorMessage(err instanceof Error ? err.message : 'Failed to render diagram')
            }
        }

        void render()

        const observer = new ResizeObserver(() => {
            void render()
        })
        observer.observe(container)

        const themeObserver = new MutationObserver(() => {
            void render()
        })
        themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['class'],
        })

        return () => {
            cancelled = true
            observer.disconnect()
            themeObserver.disconnect()
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
            ref={containerRef}
            className={`mermaid-diagram w-full${status === 'loading' ? ' mermaid-loading text-muted-foreground text-sm' : ''}`}
            aria-busy={status === 'loading'}
            aria-label={status === 'loading' ? 'Loading diagram' : 'Mermaid diagram'}
        >
            {status === 'loading' ? 'Loading diagram…' : null}
            {svgMarkup ? (
                <div ref={svgRef} className="mermaid-diagram-svg w-full" dangerouslySetInnerHTML={{ __html: svgMarkup }} />
            ) : null}
        </div>
    )
}
