// Docs search: the header's "Search docs" button and ⌘K open this dialog,
// which finds a page by its title or section (every tab). A lazy chunk:
// App.tsx imports it only when the reader first opens search.
import { Hash } from 'lucide-react'
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command'
import type { NavItem } from '../types'
import { scoreDocMatch } from './searchRank'

interface DocsSearchProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    /** Pages by section (docNav.docSearchGroups); computed by the caller so this chunk imports nothing of the App's. */
    groups: { title: string; pages: NavItem[] }[]
    onSelect: (item: NavItem) => void
}

export default function DocsSearch({ open, onOpenChange, groups, onSelect }: DocsSearchProps) {
    return (
        <CommandDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Search documentation"
            description="Find a page by its title or section"
            className="aiui-docs-search-dialog"
            loop
            // value is the page path; keywords are [title, section].
            filter={(_value, search, keywords) => scoreDocMatch(keywords?.[0] ?? '', keywords?.[1] ?? '', search)}
        >
            <CommandInput placeholder="Search docs" />
            <CommandList>
                <CommandEmpty>No pages match.</CommandEmpty>
                {groups.map((group) => (
                    <CommandGroup key={group.title} heading={group.title}>
                        {group.pages.map((page) => (
                            <CommandItem
                                key={`${page.path}:${page.title}`}
                                value={`${page.path}:${page.title}`}
                                keywords={[page.title, group.title]}
                                onSelect={() => {
                                    onOpenChange(false)
                                    onSelect(page)
                                }}
                            >
                                <Hash aria-hidden="true" />
                                <span className="truncate">{page.title}</span>
                            </CommandItem>
                        ))}
                    </CommandGroup>
                ))}
            </CommandList>
        </CommandDialog>
    )
}
