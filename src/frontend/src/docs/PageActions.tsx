// "Copy page" and its menu above a docs article: the page as Markdown for an
// assistant (copy, view; Cmd/Ctrl+C with nothing selected copies too), a PDF (the
// browser's Print, laid out by docs.css @media print; docs/print.ts), the page read
// aloud (docs/listen.ts, lazy), a new chat in an assistant that reads it, links of
// the site's own, and on a site `aiui serve` runs, the docs MCP server (copy its URL,
// add it to an editor). Which ones, in which order: `actions` (pageActionList).
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ClipboardCopy, ExternalLink, FileCode2, FileDown, Link2, Plug, Volume2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { loadDoc, peekDoc, prefetchDoc } from './docLoader'
import { docsIcon } from './docsHomeIcons'
import {
    AI_TARGETS, DEFAULT_PAGE_ACTIONS, actionGroup, assistantPrompt, copyText, fillHref, isCopyPageShortcut, mcpLinks, promptLinks,
    type AiTarget, type PageAction,
} from './pageActionLinks'
import type { Reader } from './listen'
import { printPage } from './print'
import { docPathToMarkdown } from '../pathUtils'
import { withBase } from '../lib/url'

type CopyState = 'idle' | 'copied' | 'failed'
type ListenState = 'idle' | 'playing' | 'paused'

type Mcp = { url: string; name: string }

const absolute = (href: string) => (typeof window === 'undefined' ? href : new URL(href, window.location.origin).href)
const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window

function Item({ icon, title, note }: { icon: ReactNode; title: string; note: string }) {
    return <>{icon}<span><strong>{title}</strong><small>{note}</small></span></>
}

export function PageActions({ path, title, mcp, actions = DEFAULT_PAGE_ACTIONS }: {
    path: string
    title: string
    mcp?: Mcp
    /** The actions, in order (pageActionList: frontmatter over `content.docs.pageActions` over the default). */
    actions?: readonly PageAction[]
}) {
    const [state, setState] = useState<CopyState>('idle')
    const [mcpState, setMcpState] = useState<CopyState>('idle')
    const [listen, setListen] = useState<ListenState>('idle')
    const reader = useRef<Reader | null>(null)
    const timer = useRef<number | undefined>(undefined)
    useEffect(() => () => window.clearTimeout(timer.current), [])

    // The agent-ready .md, warmed on hover/focus so the click copies at once (Safari).
    const mdPath = docPathToMarkdown(path)
    const warm = () => prefetchDoc(mdPath)
    const mdHref = withBase(mdPath)
    const mdUrl = absolute(mdHref)
    const prompt = assistantPrompt(mdUrl, title)
    const links = promptLinks(prompt)
    const mcpUrl = mcp && absolute(withBase(mcp.url))
    const editors = mcp && mcpUrl ? mcpLinks(mcpUrl, mcp.name) : null
    const shown = actions.filter((a) => (a === 'mcp' ? !!editors : a === 'listen' ? canSpeak() : true))
    const hasCopy = shown.includes('copy')
    const menu = shown.filter((a) => a !== 'copy' || shown.length > 1)

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
    const copyRef = useRef(copyPage)
    copyRef.current = copyPage

    // Cmd/Ctrl+C with nothing selected (and not in a text field) copies the page.
    useEffect(() => {
        if (!hasCopy) return
        const onKey = (event: KeyboardEvent) => {
            if (!isCopyPageShortcut(event, window.getSelection()?.toString() ?? '', event.target)) return
            event.preventDefault()
            void copyRef.current()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [hasCopy])

    // Reading stops when the reader leaves the page.
    useEffect(() => () => {
        reader.current?.stop()
        reader.current = null
        setListen('idle')
    }, [path])

    const startListening = async () => {
        const article = document.querySelector('#main-content article.aiui-doc')
        if (!article) return
        const { articleBlocks, readAloud, speechChunks } = await import('./listen')
        reader.current?.stop()
        setListen('playing')
        reader.current = readAloud(speechChunks(articleBlocks(article)), () => {
            reader.current = null
            setListen('idle')
        })
    }
    const togglePause = () => {
        if (listen === 'playing') reader.current?.pause()
        else reader.current?.resume()
        setListen(listen === 'playing' ? 'paused' : 'playing')
    }
    const stopListening = () => {
        reader.current?.stop()
        reader.current = null
        setListen('idle')
    }

    const copyMcp = async (event: Event) => {
        event.preventDefault() // keep the menu open to show "Copied"
        setMcpState(mcpUrl && (await copyText(mcpUrl)) ? 'copied' : 'failed')
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setMcpState('idle'), 2000)
    }

    const act = (onSelect: (e: Event) => void, icon: ReactNode, name: string, note: string) => (
        <DropdownMenuItem onSelect={onSelect}><Item icon={icon} title={name} note={note} /></DropdownMenuItem>
    )
    // rel: noopener for our own pages, noopener noreferrer for other sites; none for an app deep link.
    const link = (href: string, icon: ReactNode, name: string, note: string, rel?: string) => (
        <DropdownMenuItem asChild>
            <a href={href} {...(rel ? { target: '_blank', rel } : {})}><Item icon={icon} title={name} note={note} /></a>
        </DropdownMenuItem>
    )
    const out = <ExternalLink aria-hidden="true" />
    const item = (a: PageAction) => {
        if (typeof a !== 'string') {
            const href = fillHref(a.href, { url: absolute(window.location.href.split('#')[0]), md: mdUrl, title, prompt })
            return href && link(href, docsIcon(a.icon, 'size-4') ?? out, a.label, a.description ?? '', /^https?:/i.test(href) ? 'noopener noreferrer' : undefined)
        }
        if (a in AI_TARGETS) return link(links[a as AiTarget], out, `Open in ${AI_TARGETS[a as AiTarget].label}`, 'Ask questions about this page', 'noopener noreferrer')
        if (a === 'copy') return act(copyPage, <ClipboardCopy aria-hidden="true" />, 'Copy page', 'As Markdown, for an assistant')
        if (a === 'view') return link(mdHref, <FileCode2 aria-hidden="true" />, 'View as Markdown', 'The page for assistants, as plain text', 'noopener')
        if (a === 'pdf') return act(() => printPage(), <FileDown aria-hidden="true" />, 'Download as PDF', 'Print or save this page')
        if (a === 'listen') return act(() => void startListening(), <Volume2 aria-hidden="true" />, 'Listen to page', 'Read aloud by your browser')
        if (a !== 'mcp' || !editors) return null
        const plug = <Plug aria-hidden="true" />
        return (
            <>
                {act(copyMcp, mcpState === 'copied' ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />, 'Copy MCP server URL',
                    mcpState === 'copied' ? 'Copied' : mcpState === 'failed' ? 'Copy failed' : 'Connect any AI tool to these docs')}
                {link(editors.cursor, plug, 'Connect to Cursor', 'Add these docs as an MCP server')}
                {link(editors.vscode, plug, 'Connect to VS Code', 'Add these docs as an MCP server')}
            </>
        )
    }

    if (!shown.length) return null
    const label = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy page'
    const announce = state === 'copied' ? 'Page copied as Markdown' : state === 'failed' ? 'Could not copy the page'
        : mcpState === 'copied' ? 'MCP server URL copied' : mcpState === 'failed' ? 'Could not copy the MCP server URL'
        : listen === 'playing' ? 'Reading the page aloud' : listen === 'paused' ? 'Reading paused' : ''
    return (
        <div className="aiui-docs-actions-menu" role="group" aria-label="Page actions" onPointerEnter={warm} onFocus={warm}>
            {listen !== 'idle' && (
                <>
                    <Button variant="outline" size="sm" onClick={togglePause} aria-label={listen === 'playing' ? 'Pause reading' : 'Resume reading'}>
                        <Volume2 aria-hidden="true" />
                        {listen === 'playing' ? 'Pause' : 'Resume'}
                    </Button>
                    <Button variant="outline" size="icon-sm" onClick={stopListening} aria-label="Stop reading">
                        <X aria-hidden="true" />
                    </Button>
                </>
            )}
            {hasCopy && (
                <Button variant="outline" size="sm" onClick={copyPage} aria-keyshortcuts="Meta+C Control+C"
                    title="Copy page as Markdown (Ctrl+C or ⌘C with nothing selected)">
                    {state === 'copied' ? <Check aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}
                    {label}
                </Button>
            )}
            {menu.length > 0 && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        {hasCopy ? (
                            <Button variant="outline" size="icon-sm" aria-label="More page actions">
                                <ChevronDown aria-hidden="true" />
                            </Button>
                        ) : (
                            <Button variant="outline" size="sm">
                                Page actions
                                <ChevronDown aria-hidden="true" />
                            </Button>
                        )}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="aiui-docs-actions-content">
                        {menu.map((a, i) => (
                            <Fragment key={typeof a === 'string' ? a : `${a.label}\n${a.href}`}>
                                {i > 0 && actionGroup(a) !== actionGroup(menu[i - 1]) && <DropdownMenuSeparator />}
                                {item(a)}
                            </Fragment>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
            <span className="sr-only" role="status" aria-live="polite">{announce}</span>
        </div>
    )
}
