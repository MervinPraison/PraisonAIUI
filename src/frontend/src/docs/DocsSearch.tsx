// Docs search: the header's "Search docs" button and ⌘K open this dialog.
// With an empty query it lists the pages by section; with a query it ranks
// page titles, section headings and section text from the site's search
// index (search-index.json, written by `aiui build`; searchIndex.ts). A lazy
// chunk: App.tsx imports it only when the reader first opens search.
import { useEffect, useMemo, useState } from 'react'
import { BookOpenText, Hash, TextQuote } from 'lucide-react'
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command'
import type { NavItem } from '../types'
import { highlightRuns, loadSearchIndex, searchDocs, type SearchIndex, type SearchResult } from './searchIndex'

interface DocsSearchProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Pages by section (docNav.docSearchGroups); computed by the caller so this chunk imports nothing of the App's. */
    groups: { title: string; pages: NavItem[] }[]
    /** Open a page, at a section when `anchor` is set. */
    onSelect: (item: NavItem, anchor?: string) => void
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

export default function DocsSearch({ open, onOpenChange, groups, onSelect }: DocsSearchProps) {
    const [query, setQuery] = useState('')
    const [index, setIndex] = useState<SearchIndex | null>(null)

    useEffect(() => {
        if (!open) return
        let live = true
        loadSearchIndex().then((loaded) => live && setIndex(loaded))
        return () => {
            live = false
        }
    }, [open])

    const results = useMemo(() => searchDocs(index, groups, query), [index, groups, query])
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
            filter={(value) => (query.trim() ? rank.get(value) ?? 0 : 1)}
        >
            <CommandInput placeholder="Search docs" value={query} onValueChange={setQuery} />
            <CommandList>
                <CommandEmpty>Nothing matches. Try fewer words.</CommandEmpty>
                {query.trim() ? (
                    <CommandGroup heading="Results">
                        {results.map((r) => (
                            <CommandItem key={resultKey(r)} value={resultKey(r)} onSelect={() => choose(r.page, r.anchor)}>
                                <ResultRow result={r} query={query} />
                            </CommandItem>
                        ))}
                    </CommandGroup>
                ) : (
                    groups.map((group) => (
                        <CommandGroup key={group.title} heading={group.title}>
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

function resultKey(r: SearchResult): string {
    return `${r.kind}:${r.page.path}#${r.anchor}`.toLowerCase()
}
