/**
 * Streamdown's `rehype-raw`, made lazy. In the build, Streamdown's own import
 * of `rehype-raw` resolves to this module (vite.config.ts `lazyRehypeRaw`), so
 * `defaultRehypePlugins.raw` is this gate and the HTML parser (parse5 and its
 * entity tables) is a chunk of its own instead of part of the renderer.
 *
 * The gate keeps Streamdown's contract (it is the plugin Streamdown checks
 * for, so `html` nodes stay raw and are not turned into text): once the real
 * plugin has loaded it runs it; before that, a tree with no raw HTML passes
 * through untouched (rehype-raw would only re-parse what is already there),
 * and a tree with raw HTML starts the load. Until then the sanitizer drops
 * that HTML; the renderer draws again when the plugin arrives
 * (Markdown.tsx `useRawPlugin`). Docs load it before the first paint when the
 * page has HTML (`preloadMarkdownPlugins`).
 */
import type { Root, RootContent } from 'hast'
import type { Options } from 'rehype-raw'
import type { VFile } from 'vfile'
import { getRawPlugin, loadRawPlugin } from './pluginLoaders'

type Node = Root | RootContent

/** Whether the tree has a `raw` node (HTML that remark-rehype kept as text). */
export function hasRawNode(node: Node): boolean {
    if (node.type === 'raw') return true
    return 'children' in node && node.children.some((child) => hasRawNode(child as Node))
}

export default function rehypeRawGate(options?: Options | null) {
    return (tree: Root, file: VFile): Root => {
        const real = getRawPlugin()
        if (real) return real(options)(tree, file) as Root
        if (hasRawNode(tree)) loadRawPlugin().catch(() => { /* the HTML stays out */ })
        return tree
    }
}
