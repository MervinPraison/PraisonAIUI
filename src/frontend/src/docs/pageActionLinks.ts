// Page actions (docs/PageActions.tsx): the page's Markdown for readers who
// work with an assistant. `aiui build` publishes every page's source next to
// it (`/docs/<page>.md`, see `docPathToMarkdown`), so these are plain links
// and one fetch on click.

/** The prompt an assistant gets: read this page's Markdown, then take questions. */
export function assistantPrompt(markdownUrl: string, title: string): string {
    return `Read ${markdownUrl} (the "${title}" page of these docs) so I can ask questions about it.`
}

/** Links that open a new chat in ChatGPT, Claude or Cursor with a prompt filled in. */
export function promptLinks(prompt: string): { chatgpt: string; claude: string; cursor: string } {
    const q = encodeURIComponent(prompt)
    return {
        chatgpt: `https://chatgpt.com/?hints=search&q=${q}`,
        claude: `https://claude.ai/new?q=${q}`,
        cursor: `https://cursor.com/link/prompt?text=${q}`,
    }
}

/** Links that open a new chat in ChatGPT or Claude that reads this page. */
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
