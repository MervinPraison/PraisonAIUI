// <Update label description tags> (markdown/docsTags.ts): one changelog entry. Its
// label is a section heading, so "On this page", site search and the copy-link
// anchors list every entry. Above a page's first entry: a tag filter kept in
// `?tags=a,b` (an entry shows when it has any chosen tag) and, with front matter
// `rss: true`, a link to the page's feed (compiler/changelog.py writes it).
// Styles: docs/docs.css (.aiui-update*).
/* eslint-disable react-refresh/only-export-components -- the filter helpers are tested on their own */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Rss } from 'lucide-react'
import { slugify } from '../markdown/slug'
import { cx } from './docsClasses'

const TAGS_CHANGED = 'aiui:update-tags'
const TOC_REFRESH = 'aiui:toc-refresh'

/** The tags chosen in a query string (`?tags=API,Fix`). */
export const chosenTags = (search: string) =>
    (new URLSearchParams(search).get('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean)

/** `href`'s path, query with `tags` (none: no `tags` parameter) and hash. */
export function withTags(href: string, tags: readonly string[]): string {
    const url = new URL(href)
    if (tags.length) url.searchParams.set('tags', tags.join(','))
    else url.searchParams.delete('tags')
    return url.pathname + url.search + url.hash
}

/** An entry shows when no tag is chosen or it has one of them. */
export const matches = (tags: readonly string[], chosen: readonly string[]) => !chosen.length || tags.some((t) => chosen.includes(t))

function subscribe(cb: () => void) {
    window.addEventListener(TAGS_CHANGED, cb)
    window.addEventListener('popstate', cb)
    return () => {
        window.removeEventListener(TAGS_CHANGED, cb)
        window.removeEventListener('popstate', cb)
    }
}

function useChosen(): string[] {
    const search = useSyncExternalStore(subscribe, () => window.location.search, () => '')
    return useMemo(() => chosenTags(search), [search])
}

function choose(tags: string[]) {
    window.history.replaceState(window.history.state, '', withTags(window.location.href, tags))
    window.dispatchEvent(new Event(TAGS_CHANGED))
}

type Bar = { tags: string[]; feed?: string }

function UpdateFilter({ tags, feed, chosen }: Bar & { chosen: string[] }) {
    const key = chosen.join(',')
    const shown = useRef(key)
    useEffect(() => {
        if (shown.current === key) return
        shown.current = key
        window.dispatchEvent(new Event(TOC_REFRESH)) // hidden entries leave "On this page"
    }, [key])
    const toggle = (t: string) => choose(chosen.includes(t) ? chosen.filter((c) => c !== t) : [...chosen, t])
    return (
        <div className="aiui-update-filter" role="group" aria-label="Filter updates by tag">
            {tags.length > 0 && (
                <>
                    <button type="button" aria-pressed={!chosen.length} onClick={() => choose([])}>All</button>
                    {tags.map((t) => (
                        <button key={t} type="button" aria-pressed={chosen.includes(t)} onClick={() => toggle(t)}>{t}</button>
                    ))}
                </>
            )}
            {feed && (
                <a className="aiui-update-rss" href={feed} type="application/rss+xml">
                    <Rss aria-hidden="true" />
                    RSS feed
                </a>
            )}
        </div>
    )
}

type UpdateProps = { label?: string; description?: string; tags?: string; anchor?: string; className?: string; children?: ReactNode }

export function Update({ label, description, tags, anchor, className, children }: UpdateProps) {
    const list = useMemo(() => (tags ?? '').split(',').filter(Boolean), [tags])
    const chosen = useChosen()
    const ref = useRef<HTMLElement>(null)
    const [bar, setBar] = useState<Bar | null>(null)
    useEffect(() => {
        // The page's first entry draws the filter, from every entry's tags.
        const el = ref.current
        const page = el?.closest('article') ?? el?.parentElement
        if (!el || !page || page.querySelector('.aiui-update') !== el) return
        const all = [...page.querySelectorAll<HTMLElement>('.aiui-update[data-tags]')].flatMap((u) => u.dataset.tags!.split(','))
        const feed = page.closest('[data-fm-rss="true"]') ? `${window.location.pathname.replace(/\/+$/, '')}/rss.xml` : undefined
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the DOM after mount; one update, no loop
        setBar({ tags: [...new Set(all)], feed })
    }, [])
    const id = anchor ?? (label ? slugify(label) : undefined)
    return (
        <>
            {bar && (bar.tags.length > 0 || bar.feed) && <UpdateFilter {...bar} chosen={chosen} />}
            <section ref={ref} className={cx('aiui-update', className)} data-tags={list.join(',') || undefined} hidden={!matches(list, chosen) || undefined}>
                <div className="aiui-update-meta">
                    {label && <h2 id={id} className="aiui-update-label">{label}</h2>}
                    {description && <p className="aiui-update-desc">{description}</p>}
                    {list.length > 0 && (
                        <p className="aiui-update-tags">
                            {list.map((t) => <span key={t} className="aiui-update-tag">{t}</span>)}
                        </p>
                    )}
                </div>
                <div className="aiui-update-body">{children}</div>
            </section>
        </>
    )
}
