/**
 * One shared watcher of the page theme for every Markdown instance (a chat
 * thread can hold hundreds). It observes <html> class/style/data-theme and
 * publishes a key that changes only when dark mode or a token mermaid uses
 * actually changes, so unrelated style writes do not re-render diagrams.
 */
import { useSyncExternalStore } from 'react'
import { MERMAID_TOKENS, mermaidConfigFromTokens } from './mermaidTokens'

type MermaidConfig = ReturnType<typeof mermaidConfigFromTokens>

const listeners = new Set<() => void>()
let observer: MutationObserver | null = null
let key = ''

function computeKey(): string {
    if (typeof document === 'undefined') return 'ssr'
    const root = document.documentElement
    const style = getComputedStyle(root)
    const dark = root.classList.contains('dark') ? 'dark' : 'light'
    return [dark, ...MERMAID_TOKENS.map((t) => style.getPropertyValue(`--${t}`).trim())].join('|')
}

function onMutate(): void {
    const next = computeKey()
    if (next === key) return
    key = next
    for (const fn of listeners) fn()
}

function subscribe(fn: () => void): () => void {
    listeners.add(fn)
    if (!observer && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
        key = computeKey()
        observer = new MutationObserver(onMutate)
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    }
    return () => {
        listeners.delete(fn)
        if (listeners.size === 0 && observer) {
            observer.disconnect()
            observer = null
        }
    }
}

function getSnapshot(): string {
    if (!observer) key = computeKey()
    return key
}

const getServerSnapshot = () => 'ssr'

/** True when <html> has the `dark` class (the Tailwind `dark:` variant). */
export function isDarkMode(): boolean {
    return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

const noSubscribe = () => () => {}

/**
 * Theme key. `enabled=false` neither subscribes nor observes, and returns a
 * constant, so a document without a diagram never re-renders on theme flips.
 */
export function useThemeKey(enabled = true): string {
    return useSyncExternalStore(enabled ? subscribe : noSubscribe, enabled ? getSnapshot : getServerSnapshot, getServerSnapshot)
}

const configCache = new Map<string, MermaidConfig>()

/** Mermaid config for the current theme, resolved once per theme key. */
export function mermaidConfigFor(themeKey: string): MermaidConfig {
    let cfg = configCache.get(themeKey)
    if (!cfg) {
        cfg = mermaidConfigFromTokens(isDarkMode())
        configCache.set(themeKey, cfg)
        while (configCache.size > 4) configCache.delete(configCache.keys().next().value as string)
    }
    return cfg
}
