/**
 * The API Reference page's logic (builtin.api-reference): the server's own
 * OpenAPI document (GET /api/openapi.json, features/openapi.py) flattened to
 * operations, grouped by tag, searched, and turned into requests.
 */

export interface OpenApiParam {
  name: string
  in: string
  required?: boolean
  schema?: { type?: string; format?: string }
}

export interface OpenApiOperation {
  operationId: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: OpenApiParam[]
  security?: unknown[]
  requestBody?: { content?: Record<string, { example?: unknown }> }
}

export interface OpenApiDoc {
  info?: { title?: string; version?: string }
  tags?: { name: string; description?: string }[]
  paths?: Record<string, Record<string, OpenApiOperation>>
  'x-websockets'?: { path: string; tag: string; summary: string }[]
}

export interface Op {
  id: string
  method: string
  path: string
  tag: string
  summary: string
  description: string
  params: OpenApiParam[]
  isPublic: boolean
  example: unknown
}

export interface OpGroup {
  tag: string
  description: string
  ops: Op[]
}

const BODY_METHODS = new Set(['post', 'put', 'patch', 'delete'])

/** Every operation in the document, in path order. */
export function operations(doc: OpenApiDoc): Op[] {
  const out: Op[] = []
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(item ?? {})) {
      out.push({
        id: op.operationId || `${method}_${path}`,
        method,
        path,
        tag: op.tags?.[0] ?? 'core',
        summary: op.summary ?? '',
        description: op.description ?? '',
        params: (op.parameters ?? []).filter((p) => p.in === 'path'),
        isPublic: Array.isArray(op.security) && op.security.length === 0,
        example: op.requestBody?.content?.['application/json']?.example,
      })
    }
  }
  return out
}

/** True when every word of `query` is in the method, path, summary or tag. */
export function matches(op: Op, query: string): boolean {
  const hay = `${op.method} ${op.path} ${op.summary} ${op.tag}`.toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w))
}

/** The operations by tag, in the document's tag order; empty groups dropped. */
export function groupOps(doc: OpenApiDoc, ops: Op[]): OpGroup[] {
  const groups = new Map<string, OpGroup>()
  for (const t of doc.tags ?? []) groups.set(t.name, { tag: t.name, description: t.description ?? '', ops: [] })
  for (const op of ops) {
    if (!groups.has(op.tag)) groups.set(op.tag, { tag: op.tag, description: '', ops: [] })
    groups.get(op.tag)!.ops.push(op)
  }
  return [...groups.values()].filter((g) => g.ops.length > 0)
}

/** The request path with each `{name}` filled in, or null while one is empty. */
export function fillPath(path: string, values: Record<string, string>): string | null {
  let missing = false
  const out = path.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = (values[name] ?? '').trim()
    if (!v) missing = true
    return encodeURIComponent(v)
  })
  return missing ? null : out
}

/** `?a=1` from what the user typed (`a=1`, `?a=1` or nothing). */
export function queryString(raw: string): string {
  const q = raw.trim().replace(/^\?/, '')
  return q ? `?${q}` : ''
}

/** Whether the form offers a JSON body for this method. */
export function hasBody(method: string): boolean {
  return BODY_METHODS.has(method)
}

/** The body box's first text: the document's example, `{}` for a write, else empty. */
export function initialBody(op: Op): string {
  if (op.example !== undefined) return JSON.stringify(op.example, null, 2)
  return op.method === 'delete' || !hasBody(op.method) ? '' : '{}'
}

/** A cURL command for the request; credentials are never written into it. */
export function curlCommand(method: string, url: string, body: string, isPublic: boolean): string {
  const parts = [`curl -X ${method.toUpperCase()} '${url.replace(/'/g, "'\\''")}'`]
  if (!isPublic) parts.push(`-H "Authorization: Bearer $AIUI_TOKEN"`)
  if (body.trim()) parts.push(`-H 'Content-Type: application/json'`, `-d '${body.trim().replace(/'/g, "'\\''")}'`)
  return parts.join(' \\\n  ')
}

/** The response text, pretty-printed when it is JSON. */
export function prettyBody(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** `?op=<operationId>` deep link: the operation to open first. */
export function initialOp(search: string, ops: Op[]): string | null {
  const want = new URLSearchParams(search).get('op')
  return want && ops.some((o) => o.id === want) ? want : null
}
