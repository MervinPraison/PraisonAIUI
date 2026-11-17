// Page actions (docs/PageActions.tsx): the page's Markdown for readers who
// work with an assistant. `aiui build` publishes every page's source next to
// it (`/docs/<page>.md`, see `docPathToMarkdown`), so these are plain links
// and one fetch on click.

/** The prompt an assistant gets: read this page's Markdown, then take questions. */
export function assistantPrompt(markdownUrl: string, title: string): string {
    return `Read ${markdownUrl} (the "${title}" page of these docs) so I can ask questions about it.`
}

/** Links that open a new chat in ChatGPT or Claude with that prompt. */
export function assistantLinks(markdownUrl: string, title: string): { chatgpt: string; claude: string } {
    const q = encodeURIComponent(assistantPrompt(markdownUrl, title))
    return {
        chatgpt: `https://chatgpt.com/?hints=search&q=${q}`,
        claude: `https://claude.ai/new?q=${q}`,
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
