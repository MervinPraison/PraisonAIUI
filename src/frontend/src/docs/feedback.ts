// "Was this page helpful?" and code-block flags (docs/DocsFeedback.tsx): where a
// vote goes, as small functions. `aiui serve` / `aiui dev` store votes at
// /api/docs/feedback (src/praisonaiui/docs_feedback.py); a static host posts
// them to `content.docs.feedback.endpoint`. Every vote also fires the window
// event `aiui:docs-feedback`, so a site can route it to its own analytics.
// Only the lazy DocsFeedback chunk imports it (types.ts: types only).
export interface DocsFeedbackConfig {
    issues?: string
    /** A URL to POST votes to; false: none (the event only). Default: the aiui server. */
    endpoint?: string | false
    /** A flag button on each code block. */
    code?: boolean
}

/** `id`: one per vote; a comment sent later carries it and replaces the vote. */
export interface Vote { id: string; path: string; value: 1 | -1; kind?: 'page' | 'code'; block?: number; comment?: string }

export const BUILTIN_ENDPOINT = '/api/docs/feedback'
export const FEEDBACK_EVENT = 'aiui:docs-feedback'

type Fetch = typeof fetch

const probes = new Map<string, Promise<boolean>>()

/** Does this server store votes? One GET per page load; a static host answers 404 or its HTML page. */
export function serverStoresVotes(url: string, fetchImpl: Fetch = fetch): Promise<boolean> {
    let probe = probes.get(url)
    if (!probe) {
        probe = fetchImpl(url, { headers: { Accept: 'application/json' } })
            .then(async (r) => r.ok && (r.headers.get('content-type') ?? '').includes('json') && (await r.json())?.enabled === true)
            .catch(() => false)
        probes.set(url, probe)
    }
    return probe
}

/** Where votes go: the configured URL, the server's own endpoint (`builtin`), or nowhere (null). */
export async function voteTarget(cfg: DocsFeedbackConfig, builtin: string, fetchImpl: Fetch = fetch): Promise<string | null> {
    if (cfg.endpoint === false) return null
    if (cfg.endpoint) return cfg.endpoint
    return (await serverStoresVotes(builtin, fetchImpl)) ? builtin : null
}

/** Fires the event and POSTs the vote; true when it was stored. */
export async function sendVote(target: string | null, vote: Vote, fetchImpl: Fetch = fetch): Promise<boolean> {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(FEEDBACK_EVENT, { detail: vote }))
    if (!target) return false
    // Another origin gets text/plain, a "simple" request with no CORS preflight.
    const crossOrigin = typeof location !== 'undefined' && new URL(target, location.href).origin !== location.origin
    try {
        const r = await fetchImpl(target, {
            method: 'POST',
            keepalive: true,
            credentials: crossOrigin ? 'omit' : 'same-origin',
            headers: { 'Content-Type': crossOrigin ? 'text/plain' : 'application/json' },
            body: JSON.stringify(vote),
        })
        return r.ok
    } catch {
        return false
    }
}

export function newVoteId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
