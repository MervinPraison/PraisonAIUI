// Try it (docs/ApiPlayground.tsx): the operation `aiui build` publishes as
// openapi/try/<page>.json (compiler/playground.py) turned into a request.

export type Param = { name: string; in: 'path' | 'query' | 'header' | 'cookie'; type?: string; required?: boolean; example?: string; enum?: string[]; array?: boolean }
export type Server = { url: string; description?: string; variables?: Record<string, { default: string; enum?: string[] }> }
/** A security scheme (compiler/openapi_pages.security_options): `x-default` arrives as `default`. */
export type AuthScheme = {
    id: string; type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect'; in?: 'header' | 'query' | 'cookie'; name?: string
    scheme?: string; scopes?: string[]; description?: string; format?: string; default?: string
}
/** `file`: the body is one file; `files`: multipart parts that are files; `base64`: JSON fields holding an encoded file. */
export type Body = { type: string; example: string; required?: boolean; file?: boolean; files?: string[]; base64?: Record<string, 'base64' | 'base64url'> }
/** `auth`: the alternatives (any one is enough), each the schemes sent together; `[]` is "none". */
export type Operation = { method: string; path: string; prefill?: boolean; servers: Server[]; params: Param[]; body?: Body; auth?: AuthScheme[][] }
/** What is sent, and what the curl command shows. `files`: multipart file parts, or `['', file]` as the whole body. */
export type Draft = { method: string; url: string; headers: [string, string][]; body?: string; bodyType?: string; files?: [string, File][] }
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

/** The request for these inputs: path values encoded, empty optional values left out, `files` chosen, `hooks` applied last. */
export function buildRequest(op: Operation, base: string, values: Record<string, string>, body = '', hooks: RequestHook[] = [],
    files: Record<string, File | undefined> = {}): Draft {
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
    const parts = Object.entries(files).filter((e): e is [string, File] => !!e[1])
    if (op.body?.file ? parts.length : op.body && (body.trim() || parts.length)) {
        draft = { ...draft, body: op.body!.file ? '' : body.trim() ? body : '{}', bodyType: op.body!.type, ...(parts.length ? { files: parts } : {}) }
        if (!op.body!.type.includes('multipart/')) headers.push(['Content-Type', op.body!.type])
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
    const files = new Map(d.files)
    if (isForm(d)) {
        lines.push(...Object.entries(formFields(d.body!)).filter(([k]) => !files.has(k)).map(([k, v]) => `--form ${sh(`${k}=${v}`)}`))
        lines.push(...[...files].map(([k, f]) => `--form ${sh(`${k}=@${f.name}`)}`))
    } else if (files.has('')) lines.push(`--data-binary ${sh(`@${files.get('')!.name}`)}`)
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
    for (const [k, f] of d.files ?? []) if (k) form.set(k, f, f.name) // a chosen file replaces its JSON field
    const headers = d.headers.filter(([k]) => k.toLowerCase() !== 'cookie')
    const file = d.files?.find(([k]) => !k)?.[1]
    return [d.url, { method: d.method, headers, body: isForm(d) ? form : file ?? d.body, signal }]
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

const isBasic = (s: AuthScheme) => s.type === 'http' && s.scheme?.toLowerCase() === 'basic'

/** A scheme's inputs as `[key, label]`: basic asks for a username and a password, the rest for one value. */
export const authInputs = (s: AuthScheme): [string, string][] =>
    isBasic(s) ? [[`${s.id}:username`, 'Username'], [`${s.id}:password`, 'Password']] : [[s.id, s.type === 'apiKey' ? s.name ?? s.id : 'Token']]

const utf8Base64 = (text: string) => btoa(Array.from(new TextEncoder().encode(text), (b) => String.fromCharCode(b)).join(''))
const MASK = '********'

/** Adds `schemes`' credentials: an API key as its header, query value or cookie, basic and bearer (and
 * OAuth2 / OpenID Connect tokens) as `Authorization`. `mask`: values shown as asterisks (the curl command). */
export function authHook(schemes: AuthScheme[], values: Record<string, string>, mask = false): RequestHook {
    return (d) => {
        let url = d.url
        const headers = [...d.headers]
        const hide = (v: string) => (mask ? MASK : v)
        for (const s of schemes) {
            const v = values[s.id]?.trim() ?? ''
            if (isBasic(s)) {
                const user = values[`${s.id}:username`] ?? '', password = values[`${s.id}:password`] ?? ''
                if (user || password) headers.push(['Authorization', `Basic ${hide(utf8Base64(`${user}:${password}`))}`])
            } else if (!v) continue
            else if (s.type === 'apiKey' && s.in === 'query') url += `${url.includes('?') ? '&' : '?'}${encodeURIComponent(s.name!)}=${encodeURIComponent(hide(v))}`
            else if (s.type === 'apiKey' && s.in === 'cookie') {
                const at = headers.findIndex(([k]) => k === 'Cookie')
                const pair = `${s.name}=${hide(v)}`
                if (at < 0) headers.push(['Cookie', pair])
                else headers[at] = ['Cookie', `${headers[at][1]}; ${pair}`]
            } else if (s.type === 'apiKey') headers.push([s.name!, hide(v)])
            else {
                const scheme = s.type === 'http' && s.scheme && s.scheme.toLowerCase() !== 'bearer' ? s.scheme : 'Bearer'
                headers.push(['Authorization', `${scheme} ${hide(v.slice(v.toLowerCase().startsWith(`${scheme.toLowerCase()} `) ? scheme.length + 1 : 0))}`])
            }
        }
        return { ...d, url, headers }
    }
}

const AUTH_KEY = 'aiui-try-auth:'

/** Credentials typed for `site`, kept in this tab's sessionStorage (never localStorage) and sent only with the request. */
export function loadAuth(site: string): Record<string, string> {
    try {
        const value = JSON.parse(window.sessionStorage.getItem(AUTH_KEY + site) ?? '{}') as unknown
        return value && typeof value === 'object' ? value as Record<string, string> : {}
    } catch {
        return {}
    }
}

export function saveAuth(site: string, values: Record<string, string>): void {
    try {
        window.sessionStorage.setItem(AUTH_KEY + site, JSON.stringify(Object.fromEntries(Object.entries(values).filter(([, v]) => v))))
    } catch { /* storage blocked: the values live as long as the form */ }
}

/** Inputs as they start: what this tab typed before, else each scheme's `x-default`. */
export const initialAuth = (op: Operation, stored: Record<string, string>): Record<string, string> => ({
    ...Object.fromEntries((op.auth ?? []).flat().filter((s) => s.default).map((s) => [s.id, s.default!])), ...stored,
})

/** A file as base64 (`base64url`: URL-safe, unpadded). */
export async function encodeFile(file: Blob, encoding: 'base64' | 'base64url' = 'base64'): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let text = ''
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const out = btoa(text)
    return encoding === 'base64url' ? out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : out
}

/** A JSON body with `name` set to `value` (a body that is not a JSON object starts over). */
export function withField(body: string, name: string, value: string): string {
    let fields: Record<string, unknown> = {}
    try {
        const parsed = JSON.parse(body) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) fields = parsed as Record<string, unknown>
    } catch { /* not JSON */ }
    return JSON.stringify({ ...fields, [name]: value }, null, 2)
}

/** Responses read as they arrive: server-sent events, NDJSON / JSON Lines. */
export const isStream = (contentType: string | null) => /event-stream|ndjson|jsonl|json-seq/i.test(contentType ?? '')
/** Reading stops here (bytes). */
export const STREAM_CAP = 10_000_000

/** Reads `res` chunk by chunk, calling `onText` with all text so far; 'capped' when it stopped at `cap` bytes.
 * Throws when the connection breaks or the request is aborted. */
export async function readBody(res: Response, onText: (text: string, bytes: number) => void, cap = STREAM_CAP): Promise<'done' | 'capped'> {
    if (!res.body) {
        const text = await res.text()
        onText(text, new Blob([text]).size)
        return 'done'
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let text = '', bytes = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        text += decoder.decode(value, { stream: true })
        onText(text, bytes)
        if (bytes >= cap) {
            void reader.cancel()
            return 'capped'
        }
    }
    onText(text + decoder.decode(), bytes)
    return 'done'
}

export type StreamEvent = { event?: string; id?: string; data: string }

/** Server-sent events in `text`, in order: `event`, `id` and the `data` lines joined; comments and empty events skipped. */
export function sseEvents(text: string): StreamEvent[] {
    const out: StreamEvent[] = []
    for (const block of text.split(/\r?\n\r?\n/)) {
        const event: StreamEvent = { data: '' }
        const data: string[] = []
        for (const line of block.split(/\r?\n/)) {
            const [, field, value = ''] = /^([^:]+)(?::\s?(.*))?$/.exec(line) ?? []
            if (field === 'data') data.push(value)
            else if (field === 'event' || field === 'id') event[field] = value
        }
        if (data.length) out.push({ ...event, data: data.join('\n') })
    }
    return out
}
