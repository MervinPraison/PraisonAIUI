// The tab picks DocsTabs.tsx syncs by title: the most recent first, kept in
// localStorage (wrapped: blocked storage keeps them for the page only).

/** Sent when a tab set changes, so "On this page" lists the headings now shown (Toc.tsx). */
export const TOC_REFRESH = 'aiui:toc-refresh'
const KEY = 'aiui-docs-tabs'
const MAX_PICKS = 20
export const NONE: readonly string[] = []
let picks: readonly string[] | null = null
const listeners = new Set<() => void>()

function load(): readonly string[] {
    try {
        const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
        return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string').slice(0, MAX_PICKS) : NONE
    } catch {
        return NONE // storage blocked: picks last for this page only
    }
}
export const snapshot = () => (picks ??= load())
export const subscribe = (fn: () => void) => {
    listeners.add(fn)
    return () => void listeners.delete(fn)
}

/** The reader picked `title`: every synced set with a tab of that title shows it, here and on later pages. */
export function pickTab(title: string): void {
    picks = [title, ...snapshot().filter((t) => t !== title)].slice(0, MAX_PICKS)
    try {
        localStorage.setItem(KEY, JSON.stringify(picks))
    } catch {
        /* private mode: this page only */
    }
    listeners.forEach((fn) => fn())
}

/** The tab a set shows: its title picked most recently, else `initial`, else the first. */
export function chosenTab(titles: readonly string[], picked: readonly string[], initial?: number): number {
    for (const p of picked) {
        const i = titles.indexOf(p)
        if (i >= 0) return i
    }
    return initial !== undefined && initial >= 0 && initial < titles.length ? initial : 0
}
