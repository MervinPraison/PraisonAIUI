/**
 * Keep the legacy DOM plugins off Streamdown's output.
 *
 * The docs, chat, agents and playground pages still load vanilla plugins from
 * templates/frontend/plugins. Two of them rewrite any code block they find:
 *
 * - syntax-highlight.js runs highlight.js over every `pre code` outside
 *   `#main-content article.prose`: after load, and again on every light/dark
 *   flip (it first strips its own "done" markers). highlight.js rebuilds the
 *   <code> from its textContent, so Shiki's per-line spans collapse into one
 *   line, and React loses the nodes it owns.
 * - code-copy.js appends a copy button (and wrapper) inside every `pre` that
 *   has no `data-copy-processed`, when plugin-loader announces content.
 *
 * The docs article is covered by the guard those plugins already honour (it
 * carries `prose`, see Content.tsx). Chat messages have no such ancestor, so
 * every Markdown root defends itself:
 *
 * - The fence's `language-<x>` class becomes `aiuilanguage-<x> nohighlight`
 *   (LegacySafeCode in chatComponents.tsx).
 *   Streamdown still finds the language (it matches /language-(\S+)/ anywhere
 *   in the class), while highlight.js, which only reads a `lang-`/`language-`
 *   class at a word boundary, falls through to `nohighlight` and skips the
 *   block (without a console warning).
 * - A MutationObserver marks every `pre` with `data-copy-processed` as it
 *   appears (Shiki's body swaps in after a lazy load) and re-marks it if
 *   plugin-loader's teardown strips the flag.
 *
 * markdown.css flattens the legacy `pre { … !important }` box styles.
 * Remove this module once the plugins skip `[data-streamdown]` themselves.
 */
import { useEffect } from 'react'

const LANGUAGE_CLASS = /(^|\s)language-(\S+)/g
export const NO_HIGHLIGHT = 'nohighlight'
const COPY_DONE = 'copyProcessed' // dataset key of code-copy.js's data-copy-processed

/** `language-ts foo` → `aiuilanguage-ts foo nohighlight` (see the module comment). */
export function legacySafeCodeClass(className?: string): string {
    const base = (className ?? '').replace(LANGUAGE_CLASS, '$1aiuilanguage-$2').trim()
    return base ? `${base} ${NO_HIGHLIGHT}` : NO_HIGHLIGHT
}

function markCopyDone(root: HTMLElement) {
    for (const pre of root.querySelectorAll('pre')) {
        if (!pre.dataset[COPY_DONE]) pre.dataset[COPY_DONE] = 'true'
    }
}

/**
 * Mark every <pre> in the Markdown root carrying `data-aiui-markdown={id}` as
 * handled for code-copy.js, now and whenever Streamdown re-renders.
 * (Streamdown forwards data-* props to its root but not a ref.)
 */
export function useLegacyCopyGuard(id: string) {
    useEffect(() => {
        if (typeof MutationObserver === 'undefined') return
        const root = document.querySelector<HTMLElement>(`[data-aiui-markdown="${CSS.escape(id)}"]`)
        if (!root) return
        markCopyDone(root)
        const observer = new MutationObserver(() => markCopyDone(root))
        observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-copy-processed'] })
        return () => observer.disconnect()
    }, [id])
}
