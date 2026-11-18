// "Copy page" and its menu above a docs article: the page as Markdown for an
// assistant (copy, view), or a new ChatGPT or Claude chat that reads it.
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ClipboardCopy, ExternalLink, FileCode2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { loadDoc, peekDoc } from './docLoader'
import { assistantLinks, copyText } from './pageActionLinks'
import { docPathToMarkdown } from '../pathUtils'
import { withBase } from '../lib/url'

type CopyState = 'idle' | 'copied' | 'failed'

export function PageActions({ path, title }: { path: string; title: string }) {
    const [state, setState] = useState<CopyState>('idle')
    const timer = useRef<number | undefined>(undefined)
    useEffect(() => () => window.clearTimeout(timer.current), [])

    const mdPath = docPathToMarkdown(path) // the URL Content.tsx loaded, so peekDoc hits
    const mdHref = withBase(mdPath)
    const mdUrl = typeof window === 'undefined' ? mdHref : new URL(mdHref, window.location.origin).href
    const links = assistantLinks(mdUrl, title)

    const copyPage = async () => {
        let ok = false
        try {
            // The article's own Markdown is in the loader's cache, so the copy
            // runs inside the click (Safari refuses clipboard writes after an await).
            const doc = peekDoc(mdPath) ?? (await loadDoc(mdPath, new AbortController().signal))
            ok = doc.ok && (await copyText(doc.text))
        } catch {
            ok = false
        }
        setState(ok ? 'copied' : 'failed')
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setState('idle'), 2000)
    }

    const label = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy page'
    return (
        <div className="aiui-docs-actions-menu" role="group" aria-label="Page actions">
            <Button variant="outline" size="sm" onClick={copyPage}>
                {state === 'copied' ? <Check aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}
                {label}
            </Button>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon-sm" aria-label="More page actions">
                        <ChevronDown aria-hidden="true" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="aiui-docs-actions-content">
                    <DropdownMenuItem onSelect={copyPage}>
                        <ClipboardCopy aria-hidden="true" />
                        <span><strong>Copy page</strong><small>As Markdown, for an assistant</small></span>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                        <a href={mdHref} target="_blank" rel="noopener">
                            <FileCode2 aria-hidden="true" />
                            <span><strong>View as Markdown</strong><small>The page source, as plain text</small></span>
                        </a>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                        <a href={links.chatgpt} target="_blank" rel="noopener noreferrer">
                            <ExternalLink aria-hidden="true" />
                            <span><strong>Open in ChatGPT</strong><small>Ask questions about this page</small></span>
                        </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                        <a href={links.claude} target="_blank" rel="noopener noreferrer">
                            <ExternalLink aria-hidden="true" />
                            <span><strong>Open in Claude</strong><small>Ask questions about this page</small></span>
                        </a>
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <span className="sr-only" role="status" aria-live="polite">
                {state === 'copied' ? 'Page copied as Markdown' : state === 'failed' ? 'Could not copy the page' : ''}
            </span>
        </div>
    )
}
