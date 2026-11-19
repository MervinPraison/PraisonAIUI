/**
 * `<aiui-block>`: a tag the site declares (`site.components`, markdown/docsTags.ts)
 * drawn by the site's own React component. Its module loads on the first page
 * that uses one of its tags (./customBlocks.ts, a lazy chunk). The component
 * gets the tag's attributes as props (and as `node.props`, like any block) and
 * the tag's Markdown body as `children`. While it loads, when it fails to load
 * or throws, the page shows that body.
 */
import { Component as ReactComponent, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { jsonish } from '../markdown/docsTags'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Block = ComponentType<any>
const loaded = new Map<string, Promise<Block | null>>()

function load(tag: string, src: string): Promise<Block | null> {
    const key = `${tag} ${src}`
    if (!loaded.has(key)) {
        loaded.set(key, import('./customBlocks').then((m) => m.loadBlock(tag, src), (err: unknown) => {
            console.warn(`[aiui docs] <${tag}> did not load`, err)
            return null
        }))
    }
    return loaded.get(key)!
}

class Boundary extends ReactComponent<{ tag: string; fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
    state = { failed: false }
    static getDerivedStateFromError() {
        return { failed: true }
    }
    componentDidCatch(error: unknown) {
        console.warn(`[aiui docs] <${this.props.tag}> failed to render`, error)
    }
    render() {
        return this.state.failed ? this.props.fallback : this.props.children
    }
}

export function CustomBlock({ tag = '', src = '', props, children }: { tag?: string; src?: string; props?: string; children?: ReactNode }) {
    const [block, setBlock] = useState<{ C: Block | null }>()
    useEffect(() => {
        let live = true
        if (tag && src) void load(tag, src).then((C) => { if (live) setBlock({ C }) })
        return () => { live = false }
    }, [tag, src])
    const values = useMemo(() => {
        const v = props ? jsonish(props) : {}
        return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
    }, [props])
    const fallback = <>{children}</>
    if (!block?.C) return fallback
    const C = block.C
    return (
        <Boundary tag={tag} fallback={fallback}>
            <C {...values} node={{ type: tag, props: values }}>{children}</C>
        </Boundary>
    )
}
