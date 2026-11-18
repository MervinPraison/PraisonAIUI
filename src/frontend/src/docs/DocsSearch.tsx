// Docs search: the header's "Search docs" button and ⌘K open this dialog.
// With an empty query it lists the pages by section; with a query it ranks
// page titles, section headings and section text from the site's search
// index (search-index.json, written by `aiui build`; searchIndex.ts). On a
// site with header tabs, chips narrow the results to one tab (the reader's
// own at first). The query is mirrored to the address bar as `?q=`, so a link
// opens search prefilled (App.tsx reads it). A lazy chunk: App.tsx imports it
// only when the reader first opens search.
import { useEffect, useMemo, useState } from 'react'
import { BookOpenText, Hash, Search, TextQuote } from 'lucide-react'
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command'
import type { NavItem, SearchGroup } from '../types'
import { highlightRuns, loadSearchIndex, searchDocs, type SearchIndex, type SearchResult } from './searchIndex'

interface DocsSearchProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Pages by section (docNav.docSearchGroups); computed by the caller so this chunk imports nothing of the App's. */
    groups: SearchGroup[]
    /** Open a page, at a section when `anchor` is set. */
    onSelect: (item: NavItem, anchor?: string) => void
    /** The index URL, with the site's base path (the App passes it: this chunk imports nothing of the App's). */
    indexUrl?: string
    /** Header tab names (two or more show the filter chips). */
    tabs?: string[]
    /** The reader's current tab: the filter when search opens. */
    activeTab?: string
    /** `search.prompt`: the field's placeholder. */
    placeholder?: string
    /** `search.maxResults`. */
    maxResults?: number
    /** A `?q=` deep link: search opens with it, over every tab. */
    initialQuery?: string
}

/** Mirror the query to `?q=` in the address bar (removed when empty), keeping the path and hash. */
function setQueryParam(q: string): void {
    const url = new URL(window.location.href)
    if (q) url.searchParams.set('q', q)
    else url.searchParams.delete('q')
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url)
}

function Marked({ text, query }: { text: string; query: string }) {
    return (
        <>
            {highlightRuns(text, query).map((run, i) => (run.hit ? <mark key={i}>{run.text}</mark> : <span key={i}>{run.text}</span>))}
        </>
    )
}

const ICON = { page: BookOpenText, section: Hash, text: TextQuote } as const

function ResultRow({ result, query }: { result: SearchResult; query: string }) {
    const Icon = ICON[result.kind]
    const title = result.kind === 'page' ? result.page.title : result.heading || result.page.title
    return (
        <>
            <Icon aria-hidden="true" />
            <span className="aiui-docs-result">
                <span className="aiui-docs-result-title"><Marked text={title} query={query} /></span>
                <span className="aiui-docs-result-crumb">
                    {result.kind === 'page' ? result.group : `${result.group} › ${result.page.title}`}
                </span>
                {result.snippet && (
                    <span className="aiui-docs-result-snippet"><Marked text={result.snippet} query={query} /></span>
                )}
            </span>
        </>
    )
}

export default function DocsSearch({ open, onOpenChange, groups, onSelect, indexUrl, tabs = [], activeTab, placeholder, maxResults, initialQuery = '' }: DocsSearchProps) {
    const [query, setQuery] = useState(initialQuery)
    const [index, setIndex] = useState<SearchIndex | null>(null)
    const showTabs = tabs.length > 1
    // '' is "All tabs". A deep link searches everywhere; a reader's own search starts in their tab.
    const [tab, setTab] = useState('')
    const [deepLink, setDeepLink] = useState(Boolean(initialQuery))
    // Each time the dialog opens (state adjusted during render, not in an effect).
    const [wasOpen, setWasOpen] = useState(false)
    if (open !== wasOpen) {
        setWasOpen(open)
        if (open) {
            setTab(deepLink || !showTabs ? '' : activeTab ?? '')
            setDeepLink(false)
        }
    }

    // Debounced: browsers limit how often a page may rewrite its URL.
    useEffect(() => {
        if (!open) {
            setQueryParam('')
            return
        }
        const timer = window.setTimeout(() => setQueryParam(query.trim()), 250)
        return () => window.clearTimeout(timer)
    }, [open, query])

    useEffect(() => {
        if (!open) return
        let live = true
        loadSearchIndex(indexUrl).then((loaded) => live && setIndex(loaded))
        return () => {
            live = false
        }
    }, [open])

    const limit = maxResults && maxResults > 0 ? Math.min(100, maxResults) : undefined
    const results = useMemo(() => searchDocs(index, groups, query, { limit, tab }), [index, groups, query, limit, tab])
    // Nothing in this tab: offer the other tabs' results instead of a dead end.
    const elsewhere = useMemo(
        () => (tab && query.trim() && !results.length ? searchDocs(index, groups, query, { limit }).length : 0),
        [index, groups, query, limit, tab, results.length],
    )
    const listed = tab ? groups.filter((g) => g.tab === tab) : groups
    // cmdk sorts by its filter's score: hand it our rank so it keeps our order.
    const rank = useMemo(() => new Map(results.map((r, i) => [resultKey(r), results.length - i])), [results])
    const choose = (item: NavItem, anchor?: string) => {
        onOpenChange(false)
        setQuery('')
        onSelect(item, anchor || undefined)
    }

    return (
        <CommandDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Search documentation"
            description="Find a page, a section or a phrase"
            className="aiui-docs-search-dialog"
            loop
            filter={(value) => (query.trim() ? rank.get(value) ?? (value === ALL_TABS ? 1 : 0) : 1)}
        >
            <CommandInput placeholder={placeholder || 'Search docs'} value={query} onValueChange={setQuery} />
            {showTabs && (
                <div className="aiui-docs-search-tabs" role="group" aria-label="Filter by tab">
                    {['', ...tabs].map((name) => (
                        <button key={name || '*'} type="button" aria-pressed={tab === name} onClick={() => setTab(name)}>
                            {name || 'All tabs'}
                        </button>
                    ))}
                </div>
            )}
            <CommandList>
                <CommandEmpty>Nothing matches. Try fewer words.</CommandEmpty>
                {elsewhere > 0 && (
                    <CommandGroup>
                        <CommandItem value={ALL_TABS} onSelect={() => setTab('')}>
                            <Search aria-hidden="true" />
                            <span>{`Nothing in ${tab}. Show ${elsewhere} ${elsewhere === 1 ? 'result' : 'results'} in all tabs`}</span>
                        </CommandItem>
                    </CommandGroup>
                )}
                {query.trim() ? (
                    <CommandGroup heading="Results">
                        {results.map((r) => (
                            <CommandItem key={resultKey(r)} value={resultKey(r)} onSelect={() => choose(r.page, r.anchor)}>
                                <ResultRow result={r} query={query} />
                            </CommandItem>
                        ))}
                    </CommandGroup>
                ) : (
                    listed.map((group, i) => (
                        <CommandGroup key={`${i}:${group.title}`} heading={group.title}>
                            {group.pages.map((page) => (
                                <CommandItem key={`${page.path}:${page.title}`} value={`${page.path}:${page.title}`} onSelect={() => choose(page)}>
                                    <BookOpenText aria-hidden="true" />
                                    <span className="truncate">{page.title}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    ))
                )}
            </CommandList>
        </CommandDialog>
    )
}

const ALL_TABS = 'aiui:all-tabs'

function resultKey(r: SearchResult): string {
    return `${r.kind}:${r.page.path}#${r.anchor}`.toLowerCase()
}
