// "Copy page" and its menu above a docs article: the page as Markdown for an
// assistant (copy, view), a new ChatGPT or Claude chat that reads it, a PDF
// (the browser's Print, laid out by docs.css @media print; docs/print.ts), and on a
// site `aiui serve` runs, the docs MCP server too (copy its URL, add it to an editor).
import { useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, ClipboardCopy, ExternalLink, FileCode2, FileDown, Link2, Plug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { loadDoc, peekDoc, prefetchDoc } from './docLoader'
import { assistantLinks, copyText, mcpLinks } from './pageActionLinks'
import { printPage } from './print'
import { docPathToMarkdown } from '../pathUtils'
import { withBase } from '../lib/url'

type CopyState = 'idle' | 'copied' | 'failed'

type Mcp = { url: string; name: string }

export function PageActions({ path, title, mcp }: { path: string; title: string; mcp?: Mcp }) {
    const [state, setState] = useState<CopyState>('idle')
    const [mcpState, setMcpState] = useState<CopyState>('idle')
    const timer = useRef<number | undefined>(undefined)
    useEffect(() => () => window.clearTimeout(timer.current), [])

    // The agent-ready .md, warmed on hover/focus so the click copies at once (Safari).
    const mdPath = docPathToMarkdown(path)
    const warm = () => prefetchDoc(mdPath)
    const mdHref = withBase(mdPath)
    const mdUrl = typeof window === 'undefined' ? mdHref : new URL(mdHref, window.location.origin).href
    const links = assistantLinks(mdUrl, title)
    const mcpUrl = mcp && (typeof window === 'undefined' ? withBase(mcp.url) : new URL(withBase(mcp.url), window.location.origin).href)
    const editors = mcp && mcpUrl ? mcpLinks(mcpUrl, mcp.name) : null

    const copyPage = async () => {
        let ok = false
        try {
            const doc = peekDoc(mdPath) ?? (await loadDoc(mdPath, new AbortController().signal))
            ok = doc.ok && (await copyText(doc.text))
        } catch {
            ok = false
        }
        setState(ok ? 'copied' : 'failed')
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setState('idle'), 2000)
    }

    const copyMcp = async (event: Event) => {
        event.preventDefault() // keep the menu open to show "Copied"
        setMcpState(mcpUrl && (await copyText(mcpUrl)) ? 'copied' : 'failed')
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setMcpState('idle'), 2000)
    }

    const label = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy page'
    return (
        <div className="aiui-docs-actions-menu" role="group" aria-label="Page actions" onPointerEnter={warm} onFocus={warm}>
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
                            <span><strong>View as Markdown</strong><small>The page for assistants, as plain text</small></span>
                        </a>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => printPage()}>
                        <FileDown aria-hidden="true" />
                        <span><strong>Download as PDF</strong><small>Print or save this page</small></span>
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
                    {editors && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={copyMcp}>
                                {mcpState === 'copied' ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}
                                <span>
                                    <strong>Copy MCP server URL</strong>
                                    <small>{mcpState === 'copied' ? 'Copied' : mcpState === 'failed' ? 'Copy failed' : 'Connect any AI tool to these docs'}</small>
                                </span>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                                <a href={editors.cursor}>
                                    <Plug aria-hidden="true" />
                                    <span><strong>Connect to Cursor</strong><small>Add these docs as an MCP server</small></span>
                                </a>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                                <a href={editors.vscode}>
                                    <Plug aria-hidden="true" />
                                    <span><strong>Connect to VS Code</strong><small>Add these docs as an MCP server</small></span>
                                </a>
                            </DropdownMenuItem>
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
            <span className="sr-only" role="status" aria-live="polite">
                {state === 'copied' ? 'Page copied as Markdown' : state === 'failed' ? 'Could not copy the page'
                    : mcpState === 'copied' ? 'MCP server URL copied' : mcpState === 'failed' ? 'Could not copy the MCP server URL' : ''}
            </span>
        </div>
    )
}
