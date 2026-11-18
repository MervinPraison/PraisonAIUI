/**
 * Docs icons. The few below are inline (lucide's icon data, ISC licence), so
 * they draw at once with no request; importing lucide components or
 * lib/pageIcons here would re-split the shared chunks of the whole bundle.
 * Keep the set small: every other lucide name loads lazily (LucideIcon).
 */
import { createElement, useEffect, useState, type ReactElement } from 'react'
import { withBase } from '../lib/url'

type IconNode = [tag: string, attrs: Record<string, string>][]

export const DOCS_HOME_ICONS: Readonly<Record<string, IconNode>> = {
    'message-square': [['path', { d: 'M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z' }]],
    'panels-top-left': [['rect', { width: '18', height: '18', x: '3', y: '3', rx: '2' }], ['path', { d: 'M3 9h18' }], ['path', { d: 'M9 21V9' }]],
    'plug': [['path', { d: 'M12 22v-5' }], ['path', { d: 'M15 8V2' }], ['path', { d: 'M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z' }], ['path', { d: 'M9 8V2' }]],
    'book-open': [['path', { d: 'M12 7v14' }], ['path', { d: 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z' }]],
    'layout-dashboard': [['rect', { width: '7', height: '9', x: '3', y: '3', rx: '1' }], ['rect', { width: '7', height: '5', x: '14', y: '3', rx: '1' }], ['rect', { width: '7', height: '9', x: '14', y: '12', rx: '1' }], ['rect', { width: '7', height: '5', x: '3', y: '16', rx: '1' }]],
    'shield-check': [['path', { d: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' }], ['path', { d: 'm9 12 2 2 4-4' }]],
    'code': [['path', { d: 'm16 18 6-6-6-6' }], ['path', { d: 'm8 6-6 6 6 6' }]],
    'zap': [['path', { d: 'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z' }]],
    'rocket': [['path', { d: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z' }], ['path', { d: 'm12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z' }], ['path', { d: 'M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0' }], ['path', { d: 'M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5' }]],
    'terminal': [['path', { d: 'M12 19h8' }], ['path', { d: 'm4 17 6-6-6-6' }]],
    'bot': [['path', { d: 'M12 8V4H8' }], ['rect', { width: '16', height: '12', x: '4', y: '8', rx: '2' }], ['path', { d: 'M2 14h2' }], ['path', { d: 'M20 14h2' }], ['path', { d: 'M15 13v2' }], ['path', { d: 'M9 13v2' }]],
    'palette': [['path', { d: 'M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z' }], ['circle', { cx: '13.5', cy: '6.5', r: '.5', fill: 'currentColor' }], ['circle', { cx: '17.5', cy: '10.5', r: '.5', fill: 'currentColor' }], ['circle', { cx: '6.5', cy: '12.5', r: '.5', fill: 'currentColor' }], ['circle', { cx: '8.5', cy: '7.5', r: '.5', fill: 'currentColor' }]],
    'arrow-right': [['path', { d: 'M5 12h14' }], ['path', { d: 'm12 5 7 7-7 7' }]],
    'arrow-up-right': [['path', { d: 'M7 7h10v10' }], ['path', { d: 'M7 17 17 7' }]],
}

const svg = (nodes: IconNode, className?: string) =>
    createElement(
        'svg',
        {
            xmlns: 'http://www.w3.org/2000/svg',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            className,
            'aria-hidden': true,
        },
        nodes.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs })),
    )

/** Lucide icons fetched so far: the drawing, or null for a name lucide does not have. */
const fetched = new Map<string, IconNode | null>()

/**
 * Any other lucide icon, from its lazy chunk (`virtual:aiui-icons`,
 * scripts/lib/lucide-icons.mjs): an empty frame of the same size until it
 * arrives, nothing for a name lucide does not have. No icon is in a chunk a
 * page already loads.
 */
function LucideIcon({ name, className }: { name: string; className?: string }) {
    const [nodes, setNodes] = useState(() => fetched.get(name))
    useEffect(() => {
        if (nodes !== undefined) return
        let live = true
        import('virtual:aiui-icons')
            .then((m) => m.default(name))
            .then(
                (found) => {
                    fetched.set(name, (found as IconNode | undefined) ?? null)
                    if (live) setNodes(fetched.get(name))
                },
                () => live && setNodes(null),
            )
        return () => {
            live = false
        }
    }, [name, nodes])
    return nodes === null ? null : svg(nodes ?? [], className)
}

/** A 24px lucide line icon by name (any lucide name; the set above draws at once), or any `docsIcon` value. */
export function DocsHomeIcon({ name, className }: { name: string; className?: string }) {
    return docsIcon(name, className)
}

const IMAGE_URL = /^(https?:)?\//
const ICON_NAME = /^[a-z0-9-]{1,60}$/

/**
 * Any icon value (`icon:` in the nav YAML or a page's frontmatter, a
 * component's `icon="…"`, `<Icon>`): an image URL (`https://…` or `/…`) as
 * <img>, an emoji as text, or a lucide name (case-insensitive) as a line
 * icon. null for anything else. The one place icon values resolve.
 */
export function docsIcon(icon: string | undefined, className?: string): ReactElement | null {
    const value = icon?.trim()
    if (!value) return null
    if (IMAGE_URL.test(value)) return createElement('img', { src: withBase(value), alt: '', className, loading: 'lazy', decoding: 'async' })
    // An emoji (or any short text with no ASCII, so never markup).
    if (value.length <= 8 && ![...value].some((c) => c.charCodeAt(0) < 128)) return createElement('span', { className, 'aria-hidden': true }, value)
    const name = value.toLowerCase()
    if (!ICON_NAME.test(name)) return null
    const inline = DOCS_HOME_ICONS[name]
    return inline ? svg(inline, className) : createElement(LucideIcon, { key: name, name, className })
}
