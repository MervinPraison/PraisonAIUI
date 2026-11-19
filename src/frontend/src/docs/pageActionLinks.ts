// Page actions (docs/PageActions.tsx): the page's Markdown for readers who
// work with an assistant. `aiui build` publishes every page's source next to
// it (`/docs/<page>.md`, see `docPathToMarkdown`), so these are plain links
// and one fetch on click.

/** The prompt an assistant gets: read this page's Markdown, then take questions. */
export function assistantPrompt(markdownUrl: string, title: string): string {
    return `Read ${markdownUrl} (the "${title}" page of these docs) so I can ask questions about it.`
}

/** Assistants that take a prompt in the URL: the menu label and the address the encoded prompt is appended to. */
export const AI_TARGETS = {
    chatgpt: { label: 'ChatGPT', base: 'https://chatgpt.com/?hints=search&q=' },
    claude: { label: 'Claude', base: 'https://claude.ai/new?q=' },
    perplexity: { label: 'Perplexity', base: 'https://www.perplexity.ai/search/new?q=' },
    grok: { label: 'Grok', base: 'https://grok.com/?q=' },
    google: { label: 'Google AI Mode', base: 'https://www.google.com/search?udm=50&q=' },
    copilot: { label: 'Copilot', base: 'https://copilot.microsoft.com/?q=' },
    mistral: { label: 'Le Chat', base: 'https://chat.mistral.ai/chat?q=' },
    cursor: { label: 'Cursor', base: 'https://cursor.com/link/prompt?text=' },
} as const
export type AiTarget = keyof typeof AI_TARGETS

/** Links that open a new chat in each assistant with a prompt filled in. */
export function promptLinks(prompt: string): Record<AiTarget, string> {
    const q = encodeURIComponent(prompt)
    return Object.fromEntries(Object.entries(AI_TARGETS).map(([id, t]) => [id, t.base + q])) as Record<AiTarget, string>
}

/** Links that open a new chat, in each assistant, that reads this page. */
export const assistantLinks = (markdownUrl: string, title: string) => promptLinks(assistantPrompt(markdownUrl, title))

/**
 * "Connect to Cursor" and "Connect to VS Code" links that add the docs MCP
 * server (`url`, served by `aiui serve`, docs_mcp.py) to the editor under `name`.
 */
export function mcpLinks(url: string, name: string): { cursor: string; vscode: string } {
    const config = btoa(JSON.stringify({ url }))
    return {
        cursor: `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(config)}`,
        vscode: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name, type: 'http', url }))}`,
    }
}

/** Copy text; false when the browser refuses (no clipboard permission, insecure origin). */
export async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        return false
    }
}

/** A built-in page action (`content.docs.pageActions`, frontmatter `pageActions`; schema/models.py PAGE_ACTIONS). */
export type PageActionId = 'copy' | 'view' | 'pdf' | 'listen' | AiTarget | 'mcp'
/** A page action of your own: `{url}`, `{md}`, `{title}` and `{prompt}` in `href` are filled in, URL-encoded. */
export interface PageActionLink { label: string; href: string; icon?: string; description?: string }
export type PageAction = PageActionId | PageActionLink

const BUILT_IN: readonly PageActionId[] = ['copy', 'view', 'pdf', 'listen', ...(Object.keys(AI_TARGETS) as AiTarget[]), 'mcp']
/** The menu when nothing is configured. */
export const DEFAULT_PAGE_ACTIONS: readonly PageActionId[] = ['copy', 'view', 'pdf', 'listen', 'chatgpt', 'claude', 'mcp']

/**
 * The actions a page shows, in order: its frontmatter `pageActions` over the
 * site's `content.docs.pageActions` over the default; `false` (or `[]`) is none.
 * Unknown ids and links without a label or href are dropped.
 */
export function pageActionList(site?: boolean | PageAction[], page?: boolean | PageAction[]): PageAction[] {
    const chosen = Array.isArray(page) || page === false ? page : Array.isArray(site) || site === false ? site : DEFAULT_PAGE_ACTIONS
    if (!chosen) return []
    const out: PageAction[] = []
    for (const a of chosen) {
        if (typeof a === 'string') {
            if (BUILT_IN.includes(a) && !out.includes(a)) out.push(a)
        } else if (a && typeof a.label === 'string' && a.label && typeof a.href === 'string') out.push(a)
    }
    return out
}

/** Which group of the menu an action sits in (a separator between groups). */
export const actionGroup = (a: PageAction): string =>
    typeof a !== 'string' ? 'link' : a in AI_TARGETS ? 'ai' : a === 'mcp' ? 'mcp' : 'page'

const UNSAFE = /^\s*(javascript|data|vbscript|file):/i

/** A custom action's href with its placeholders filled in (URL-encoded); null for a script or data URL. */
export function fillHref(href: string, values: { url: string; md: string; title: string; prompt: string }): string | null {
    if (UNSAFE.test(href) || !/^([a-z][a-z\d+.-]*:|\/)/i.test(href.trim())) return null
    return href.trim().replace(/\{(url|md|title|prompt)\}/g, (_, key: keyof typeof values) => encodeURIComponent(values[key]))
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'repeat' | 'defaultPrevented'>

/**
 * Cmd+C / Ctrl+C with nothing selected and focus outside a text field: copy the
 * page as Markdown (the keys would otherwise copy nothing).
 */
export function isCopyPageShortcut(event: KeyLike, selectedText: string, target: EventTarget | null): boolean {
    if (event.defaultPrevented || event.repeat || event.shiftKey || event.altKey) return false
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'c' || selectedText !== '') return false
    const el = target as (HTMLElement & { isContentEditable?: boolean }) | null
    const tag = el?.tagName?.toLowerCase()
    return !(tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable)
}
