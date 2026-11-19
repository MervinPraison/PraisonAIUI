// Ask AI over the docs (docs/AskAi.tsx): the request to `aiui serve`'s
// /api/docs/ask (src/praisonaiui/docs_assistant.py), its Server-Sent Events,
// and the answer's [n] citations turned into links to the cited sections.
// Only the lazy AskAi chunk imports it.

export interface AskSource { n: number; title: string; heading: string; path: string; url: string; snippet: string }

export type AskEvent =
    | { type: 'sources'; sources: AskSource[] }
    | { type: 'text'; text: string }
    | { type: 'unavailable' | 'error'; message: string }
    | { type: 'done' }

export interface AskBody {
    question: string
    context?: string
    page?: string
    history?: { role: 'user' | 'assistant'; content: string }[]
}

/** The complete events in `buffer`, and the incomplete tail to keep for the next chunk. */
export function parseEvents(buffer: string): { events: AskEvent[]; rest: string } {
    const blocks = buffer.replace(/\r\n/g, '\n').split('\n\n')
    const rest = blocks.pop() ?? ''
    const events: AskEvent[] = []
    for (const block of blocks) {
        let name = 'message', data = ''
        for (const line of block.split('\n')) {
            if (line.startsWith('event:')) name = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim()
        }
        let payload: unknown
        try {
            payload = JSON.parse(data || 'null')
        } catch {
            continue
        }
        const p = (payload ?? {}) as Record<string, unknown>
        if (name === 'sources' && Array.isArray(payload)) events.push({ type: 'sources', sources: payload as AskSource[] })
        else if (name === 'text' && typeof p.text === 'string') events.push({ type: 'text', text: p.text })
        else if ((name === 'unavailable' || name === 'error') && typeof p.message === 'string') events.push({ type: name, message: p.message })
        else if (name === 'done') events.push({ type: 'done' })
    }
    return { events, rest }
}

/** POST the question and hand each event to `onEvent`; a failed request is an `error` event. */
export async function streamAsk(url: string, body: AskBody, onEvent: (e: AskEvent) => void, signal?: AbortSignal,
    fetchImpl: typeof fetch = fetch): Promise<void> {
    // Another origin (a static host's `endpoint`) gets text/plain: a "simple" request, no CORS preflight.
    const crossOrigin = typeof location !== 'undefined' && new URL(url, location.href).origin !== location.origin
    let res: Response
    try {
        res = await fetchImpl(url, {
            method: 'POST', signal, credentials: crossOrigin ? 'omit' : 'same-origin',
            headers: { 'Content-Type': crossOrigin ? 'text/plain' : 'application/json', Accept: 'text/event-stream' },
            body: JSON.stringify(body),
        })
    } catch {
        if (!signal?.aborted) onEvent({ type: 'error', message: 'Could not reach the docs server. Check your connection and try again.' })
        return
    }
    if (!res.ok || !res.body) {
        onEvent({ type: 'error', message: res.status === 429 ? 'Too many questions. Try again in a minute.' : 'The docs server could not answer. Try again.' })
        return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            const parsed = parseEvents(buffer + decoder.decode(value, { stream: true }))
            buffer = parsed.rest
            parsed.events.forEach(onEvent)
        }
    } catch {
        if (!signal?.aborted) onEvent({ type: 'error', message: 'The answer was cut off. Try again.' })
    }
}

const FENCE = /^\s*(`{3,}|~{3,})/
const SPAN = /(`+)[^`]*?\1/g

/** `[1]` (and `[2][3]`) as links to the cited sections, outside code (`[[1]](url)`: an escaped `\[` would read as math). Unknown numbers stay text. */
export function linkCitations(md: string, sources: AskSource[]): string {
    const urls = new Map(sources.map((s) => [s.n, s.url]))
    const link = (text: string) => text.replace(/\[(\d{1,2})\](?![(:])/g, (whole, n: string) => {
        const url = urls.get(Number(n))
        return url ? `[[${n}]](${url.replace(/[()\s]/g, encodeURIComponent)})` : whole
    })
    let fence: string | null = null
    return md.split('\n').map((line) => {
        const f = FENCE.exec(line)
        if (f) {
            fence = fence ? (f[1][0] === fence[0] ? null : fence) : f[1]
            return line
        }
        if (fence) return line
        let out = '', last = 0
        for (const m of line.matchAll(SPAN)) {
            out += link(line.slice(last, m.index)) + m[0]
            last = (m.index ?? 0) + m[0].length
        }
        return out + link(line.slice(last))
    }).join('\n')
}
