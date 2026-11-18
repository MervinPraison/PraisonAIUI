// Try it (docs/ApiPlayground.tsx): the operation `aiui build` publishes as
// openapi/try/<page>.json (compiler/playground.py) turned into a request.

export type Param = { name: string; in: 'path' | 'query' | 'header' | 'cookie'; type?: string; required?: boolean; example?: string; enum?: string[]; array?: boolean }
export type Server = { url: string; description?: string; variables?: Record<string, { default: string; enum?: string[] }> }
export type Operation = { method: string; path: string; prefill?: boolean; servers: Server[]; params: Param[]; body?: { type: string; example: string; required?: boolean } }
/** What is sent, and what the curl command shows. */
export type Draft = { method: string; url: string; headers: [string, string][]; body?: string; bodyType?: string }
/** Changes a draft before it is shown and sent: authentication inputs add their header, query or cookie here. */
export type RequestHook = (draft: Draft) => Draft

/** The hooks Try it runs on every request, in order. */
export const requestHooks: RequestHook[] = []

export const paramKey = (p: Pick<Param, 'in' | 'name'>) => `${p.in}:${p.name}`

/** Inputs as they start: the examples with `prefill` (the default), else empty. */
export const initialValues = (op: Operation): Record<string, string> =>
    Object.fromEntries(op.params.map((p) => [paramKey(p), op.prefill !== false ? p.example ?? '' : '']))

export const initialVariables = (server?: Server): Record<string, string> =>
    Object.fromEntries(Object.entries(server?.variables ?? {}).map(([k, v]) => [k, v.default]))

/** The server's URL with its `{variables}` filled; a relative or missing one joins `origin` (the docs site). */
export function serverUrl(server: Server | undefined, variables: Record<string, string>, origin: string): string {
    const url = (server?.url ?? '').replace(/\{([^{}]+)\}/g, (m, name: string) => variables[name] ?? server?.variables?.[name]?.default ?? m)
    return (/^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : new URL(url || '/', `${origin}/`).href).replace(/\/+$/, '')
}

/** Required parameters left empty, by name. */
export const missing = (op: Operation, values: Record<string, string>) =>
    op.params.filter((p) => p.required && !values[paramKey(p)]?.trim()).map((p) => p.name)

/** The request for these inputs: path values encoded, empty optional values left out, `hooks` applied last. */
export function buildRequest(op: Operation, base: string, values: Record<string, string>, body = '', hooks: RequestHook[] = []): Draft {
    const value = (p: Param) => values[paramKey(p)]?.trim() ?? ''
    const path = op.path.replace(/\{([^{}]+)\}/g, (m, name: string) => {
        const p = op.params.find((x) => x.in === 'path' && x.name === name)
        return p && value(p) ? encodeURIComponent(value(p)) : m
    })
    const query = new URLSearchParams()
    const headers: [string, string][] = []
    const cookies: string[] = []
    for (const p of op.params.filter(value)) {
        const v = value(p)
        if (p.in === 'query') for (const part of p.array ? v.split(',').map((s) => s.trim()).filter(Boolean) : [v]) query.append(p.name, part)
        else if (p.in === 'header') headers.push([p.name, v])
        else if (p.in === 'cookie') cookies.push(`${p.name}=${v}`)
    }
    if (cookies.length) headers.push(['Cookie', cookies.join('; ')])
    let draft: Draft = { method: op.method, url: base + path + (String(query) ? `?${query}` : ''), headers }
    if (op.body && body.trim()) {
        draft = { ...draft, body, bodyType: op.body.type }
        if (!op.body.type.includes('multipart/')) headers.push(['Content-Type', op.body.type])
    }
    return hooks.reduce((d, hook) => hook(d), draft)
}

const sh = (text: string) => `'${text.replace(/'/g, "'\\''")}'`
const isForm = (d: Draft) => d.body !== undefined && !!d.bodyType?.includes('multipart/')

/** A multipart body is written as a JSON object of its fields. */
function formFields(body: string): Record<string, string> {
    try {
        const value = JSON.parse(body) as unknown
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]))
        }
    } catch { /* not JSON: no fields */ }
    return {}
}

/** The draft as a curl command (the request examples' layout). */
export function curl(d: Draft): string {
    const lines = [`curl --request ${d.method}`, `--url ${sh(d.url)}`, ...d.headers.map(([k, v]) => `--header ${sh(`${k}: ${v}`)}`)]
    if (isForm(d)) lines.push(...Object.entries(formFields(d.body!)).map(([k, v]) => `--form ${sh(`${k}=${v}`)}`))
    else if (d.body !== undefined) lines.push(`--data ${sh(d.body)}`)
    return lines.join(' \\\n  ')
}

/** Why the body cannot be sent as written, or ''. */
export function bodyProblem(d: Draft): string {
    if (d.body === undefined || !/json|multipart\//.test(d.bodyType ?? '')) return ''
    try {
        JSON.parse(d.body)
        return ''
    } catch {
        return isForm(d) ? 'Write the form fields as a JSON object.' : 'The body is not valid JSON.'
    }
}

/** `fetch` arguments. A browser sends only the cookies it holds for the API's site, so `Cookie` stays in curl. */
export function fetchArgs(d: Draft, signal?: AbortSignal): [string, RequestInit] {
    const form = new FormData()
    if (isForm(d)) for (const [k, v] of Object.entries(formFields(d.body!))) form.append(k, v)
    const headers = d.headers.filter(([k]) => k.toLowerCase() !== 'cookie')
    return [d.url, { method: d.method, headers, body: isForm(d) ? form : d.body, signal }]
}

/** A response body as shown: JSON pretty-printed, anything else as it came. */
export function prettyBody(text: string, contentType: string | null): string {
    try {
        return /json/i.test(contentType ?? '') || /^\s*[[{]/.test(text) ? JSON.stringify(JSON.parse(text), null, 2) : text
    } catch {
        return text
    }
}

/** `1.2 kB`, `830 B`. */
export const byteSize = (n: number) => (n < 1000 ? `${n} B` : n < 1e6 ? `${(n / 1000).toFixed(1)} kB` : `${(n / 1e6).toFixed(1)} MB`)
