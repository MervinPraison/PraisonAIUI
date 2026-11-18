/**
 * API Reference (builtin.api-reference): every route this server answers,
 * read from its live OpenAPI document (GET /api/openapi.json,
 * features/openapi.py), grouped by the feature that owns it and searchable.
 * Pick a route to read it and send a request to this same server: path
 * parameters, a query string and a JSON body (prefilled from the
 * document's example), the response with its status and time, and a cURL
 * command without credentials. Same origin, so the signed-in session's token
 * goes with the request (lib/auth.ts) and no proxy is needed.
 * `?op=<operationId>` opens one route.
 */
import { useEffect, useMemo, useState } from 'react'
// Only icons the chat route does not import (R10, see ConnectPage).
import { ClipboardCopy, Download, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { notify } from '@/sdk/notify'
import { useJson, type Tone } from '../shared'
import { PageBody, Pill, Section } from '../ui'
import { curlCommand, fillPath, groupOps, hasBody, initialBody, initialOp, matches, operations, prettyBody, queryString, type OpenApiDoc, type Op } from './model'

const METHOD_TONE: Record<string, Tone> = { get: 'info', post: 'ok', put: 'warn', patch: 'warn', delete: 'bad' }
const MAX_SHOWN = 200_000

function Method({ method }: { method: string }) {
  return <Pill tone={METHOD_TONE[method] ?? 'idle'}>{method.toUpperCase()}</Pill>
}

interface Result {
  status: number
  statusText: string
  ms: number
  body: string
}

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => void notify(`${what} copied`),
    () => void notify('Could not copy: select the text instead', { type: 'error' }),
  )
}

function TryIt({ op }: { op: Op }) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [body, setBody] = useState(() => initialBody(op))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)
  const path = fillPath(op.path, values)
  const url = path === null ? null : path + queryString(query)

  const send = async () => {
    if (url === null) return
    setBusy(true)
    setError(null)
    const started = performance.now()
    try {
      const withBody = hasBody(op.method) && body.trim() !== ''
      const res = await fetch(url, {
        method: op.method.toUpperCase(),
        headers: withBody ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
        body: withBody ? body : undefined,
      })
      const text = await res.text()
      setResult({ status: res.status, statusText: res.statusText, ms: Math.round(performance.now() - started), body: prettyBody(text) })
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {op.params.length > 0 && (
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-xs font-medium text-muted-foreground">Path parameters</legend>
          {op.params.map((p) => (
            <label key={p.name} className="flex min-w-0 flex-col gap-1 text-xs sm:flex-row sm:items-center sm:gap-3">
              <span className="font-mono text-foreground sm:w-36 sm:shrink-0">{p.name}<span className="text-tier-3"> {p.schema?.type ?? 'string'}</span></span>
              <Input value={values[p.name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))} placeholder="required" />
            </label>
          ))}
        </fieldset>
      )}
      <label className="flex min-w-0 flex-col gap-1 text-xs">
        <span className="font-medium text-muted-foreground">Query string</span>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="limit=10&offset=0" className="font-mono" />
      </label>
      {hasBody(op.method) && (
        <label className="flex min-w-0 flex-col gap-1 text-xs">
          <span className="font-medium text-muted-foreground">JSON body</span>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(14, Math.max(4, body.split('\n').length + 1))} className="font-mono text-xs" spellCheck={false} />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void send()} disabled={busy || url === null}>{busy ? 'Sending…' : 'Send request'}</Button>
        <Button variant="outline" onClick={() => copy(curlCommand(op.method, window.location.origin + (url ?? op.path), hasBody(op.method) ? body : '', op.isPublic), 'cURL command')}>
          <ClipboardCopy aria-hidden />
          Copy cURL
        </Button>
        {url === null && <span className="text-xs text-muted-foreground">Fill in the path parameters first.</span>}
      </div>
      {error && <p role="alert" className="m-0 rounded-md bg-danger-soft px-3 py-2 text-sm text-destructive">Request failed: {error}</p>}
      {result && (
        <div role="status" className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Pill tone={result.status < 300 ? 'ok' : result.status < 500 ? 'warn' : 'bad'}>{`${result.status} ${result.statusText}`.trim()}</Pill>
            <span>{result.ms} ms</span>
          </div>
          <pre className="m-0 max-h-96 overflow-auto rounded-md border border-hairline bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all text-foreground">
            {result.body.length > MAX_SHOWN ? `${result.body.slice(0, MAX_SHOWN)}\n… (${result.body.length - MAX_SHOWN} more characters)` : result.body || '(empty body)'}
          </pre>
        </div>
      )}
    </div>
  )
}

function Detail({ op }: { op: Op }) {
  return (
    <article aria-label={`${op.method.toUpperCase()} ${op.path}`} className="flex min-w-0 flex-col gap-4 rounded-lg border border-hairline p-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Method method={op.method} />
        <code className="min-w-0 font-mono text-sm break-all text-foreground">{op.path}</code>
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-lg font-semibold tracking-tight">{op.summary}</h2>
        {op.description && <p className="m-0 text-sm whitespace-pre-wrap text-muted-foreground">{op.description}</p>}
        <p className="m-0 text-xs text-tier-3">{op.isPublic ? 'Public: no sign-in needed.' : 'Uses your session; other clients send a bearer token.'}</p>
      </div>
      {/* A fresh form per route: its fields and response belong to that route. */}
      <TryIt key={op.id} op={op} />
    </article>
  )
}

function ApiReferencePage() {
  const res = useJson<OpenApiDoc>('/api/openapi.json')
  const doc = res.data
  const ops = useMemo(() => (doc ? operations(doc) : []), [doc])
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const shown = useMemo(() => (query.trim() ? ops.filter((o) => matches(o, query)) : ops), [ops, query])
  const groups = useMemo(() => (doc ? groupOps(doc, shown) : []), [doc, shown])
  const selected = picked ?? (ops.length ? initialOp(window.location.search, ops) : null)
  const op = ops.find((o) => o.id === selected) ?? null

  useEffect(() => {
    if (!picked) return
    const params = new URLSearchParams(window.location.search)
    params.set('op', picked)
    window.history.replaceState(window.history.state, '', `?${params}${window.location.hash}`)
  }, [picked])

  const download = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }))
    a.download = 'openapi.json'
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  if (res.error && !doc) {
    return (
      <PageBody>
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="m-0 text-sm">Could not load this server's API: {res.error}</p>
          <Button size="sm" variant="outline" onClick={() => res.reload()}><RotateCw aria-hidden />Try again</Button>
        </div>
      </PageBody>
    )
  }
  if (!doc) {
    return (
      <PageBody>
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading the API">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      </PageBody>
    )
  }

  const sockets = doc['x-websockets'] ?? []
  return (
    <PageBody wide>
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="m-0 text-xl font-semibold tracking-tight">This server&apos;s API</h1>
          <p className="m-0 text-sm text-muted-foreground">
            {ops.length} routes on this server{doc.info?.version ? ` · aiui ${doc.info.version}` : ''} · read from the live route table
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={download}><Download aria-hidden />OpenAPI JSON</Button>
      </header>
      <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <nav aria-label="Routes" className="flex min-w-0 flex-col gap-4">
          <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search method, path or text" aria-label="Search routes" />
          {groups.length === 0 && <p className="m-0 text-sm text-muted-foreground">No route matches “{query}”.</p>}
          <div className="flex max-h-[70vh] min-w-0 flex-col gap-4 overflow-auto pr-1">
            {groups.map((g) => (
              <div key={g.tag} className="flex min-w-0 flex-col gap-0.5">
                <h2 className="m-0 px-2 pb-1 text-2xs font-medium tracking-wide text-tier-3 uppercase" title={g.description}>{g.tag}</h2>
                {g.ops.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    aria-current={o.id === selected ? 'true' : undefined}
                    onClick={() => setPicked(o.id)}
                    className={cn('flex min-h-9 min-w-0 items-center gap-2 rounded-md px-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring', o.id === selected ? 'bg-accent-soft' : 'hover:bg-muted')}
                  >
                    <span className="w-14 shrink-0"><Method method={o.method} /></span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={o.summary}>{o.path}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </nav>
        <div className="order-first flex min-w-0 flex-col gap-6 md:order-none">
          {op ? <Detail op={op} /> : <p className="m-0 rounded-lg border border-dashed border-hairline p-6 text-sm text-muted-foreground">Pick a route to read it and send a request to this server.</p>}
          {sockets.length > 0 && (
            <Section title="WebSockets" meta="Browsers connect with a one-time ticket from POST /api/auth/ws-ticket">
              <ul className="m-0 flex list-none flex-col divide-y divide-hairline rounded-md border border-hairline p-0">
                {sockets.map((s) => (
                  <li key={s.path} className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <code className="font-mono text-xs text-foreground">{s.path}</code>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{s.summary}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </PageBody>
  )
}

export default ApiReferencePage
