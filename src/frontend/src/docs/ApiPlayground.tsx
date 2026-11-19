// Try it: the request form an endpoint page opens from its endpoint bar
// (docs/ApiFields.tsx, lazy chunk). It reads the operation `aiui build`
// published (openapi/try/<page>.json), sends with fetch from the reader's
// browser (no proxy) and shows status, time, size, headers and body (a stream
// as it arrives). Credentials stay in this tab's sessionStorage.
// Request logic: docs/playground.ts. Styles: docs/playground.css.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ClipboardCopy, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
    authHook, authInputs, bodyProblem, buildRequest, byteSize, curl, encodeFile, fetchArgs, initialAuth, initialValues, initialVariables, isStream,
    loadAuth, missing, paramKey, prettyBody, readBody, requestHooks, saveAuth, serverUrl, sseEvents, STREAM_CAP, withField,
    type AuthScheme, type Operation,
} from './playground'
import './playground.css'

const GROUPS = [['path', 'Path parameters'], ['query', 'Query parameters'], ['header', 'Headers'], ['cookie', 'Cookies']] as const
const SHOWN = 200_000 // characters of a response body drawn
type Result = { status: number; statusText: string; ms: number; size: number; headers: [string, string][]; body: string; type: string; live?: boolean; note?: string } | { error: string }
type FieldProps = { id: string; label: string; hint?: string; required?: boolean; options?: string[]; value: string; onChange: (v: string) => void; secret?: boolean }

function Field({ id, label, hint, required, options, value, onChange, secret }: FieldProps) {
    return (
        <div className="aiui-try-field">
            <label htmlFor={id}>
                <span className="aiui-try-name">{label}</span>
                {hint && <span className="aiui-try-type">{hint}</span>}
                {required && <span className="aiui-try-req">required</span>}
            </label>
            {options ? (
                <select id={id} className="aiui-try-select" value={value} onChange={(e) => onChange(e.target.value)}>
                    {!required && <option value="">Not set</option>}
                    {options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
            ) : <Input id={id} type={secret ? 'password' : 'text'} value={value} autoComplete="off" spellCheck={false} onChange={(e) => onChange(e.target.value)} />}
        </div>
    )
}

function FileField({ id, label, hint, onChange }: { id: string; label: string; hint: string; onChange: (file: File | undefined) => void }) {
    return (
        <div className="aiui-try-field">
            <label htmlFor={id}><span className="aiui-try-name">{label}</span><span className="aiui-try-type">{hint}</span></label>
            <input id={id} type="file" className="aiui-try-file" onChange={(e) => onChange(e.target.files?.[0])} />
        </div>
    )
}

const schemeHint = (s: AuthScheme) => s.type === 'apiKey' ? `API key in ${s.in}`
    : s.type === 'http' ? `${s.scheme ?? 'bearer'}${s.format ? ` (${s.format})` : ''}` : s.type === 'oauth2' ? 'OAuth 2.0 token' : 'OpenID Connect token'

function Response({ result }: { result: Extract<Result, { status: number }> }) {
    const events = /event-stream/i.test(result.type) ? sseEvents(result.body) : null
    return (
        <>
            <details className="aiui-try-headers">
                <summary>Headers ({result.headers.length})</summary>
                <dl>{result.headers.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            </details>
            {result.live && <p className="aiui-try-hint" role="status"><Spinner /> Receiving</p>}
            {result.note && <p className="aiui-try-hint" role="status">{result.note}</p>}
            {events?.length ? (
                <ol className="aiui-try-events" aria-label={`${events.length} events`}>
                    {events.slice(-500).map((e, i) => (
                        <li key={i}>{(e.event || e.id) && <span className="aiui-try-type">{[e.event, e.id && `id ${e.id}`].filter(Boolean).join(' · ')}</span>}<pre>{prettyBody(e.data, null)}</pre></li>
                    ))}
                </ol>
            ) : <pre className="aiui-try-code">{result.body.slice(0, SHOWN) || 'Empty body'}</pre>}
            {result.body.length > SHOWN && <p className="aiui-try-hint">Showing the first {SHOWN.toLocaleString()} characters.</p>}
        </>
    )
}

/** `url`: the form data (base path applied) and `copy` come from the endpoint bar, so this chunk imports nothing from the docs App chunk. */
export default function ApiPlayground({ url, method, path, copy, onClose }: {
    url: string; method: string; path: string; copy: (text: string) => Promise<boolean>; onClose: () => void
}) {
    const dialog = useRef<HTMLDialogElement>(null)
    const abort = useRef<AbortController | null>(null)
    const [op, setOp] = useState<Operation | null>(null)
    const [loadError, setLoadError] = useState(false)
    const [server, setServer] = useState(0)
    const [variables, setVariables] = useState<Record<string, string>>({})
    const [values, setValues] = useState<Record<string, string>>({})
    const [body, setBody] = useState('')
    const [files, setFiles] = useState<Record<string, File | undefined>>({})
    const site = url.split('/openapi/try/')[0] || '/'
    const [auth, setAuth] = useState<Record<string, string>>({})
    const [option, setOption] = useState(0)
    const [reveal, setReveal] = useState(false)
    const [result, setResult] = useState<Result | null>(null)
    const [sending, setSending] = useState(false)
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        dialog.current?.showModal()
        const controller = new AbortController()
        fetch(url, { signal: controller.signal })
            .then((r) => (r.ok ? r.json() as Promise<Operation> : Promise.reject(new Error(String(r.status)))))
            .then((data) => {
                setOp(data)
                setValues(initialValues(data))
                setVariables(initialVariables(data.servers[0]))
                setBody(data.body && data.prefill !== false ? data.body.example : '')
                setAuth(initialAuth(data, loadAuth(site)))
            }, () => !controller.signal.aborted && setLoadError(true))
        return () => {
            controller.abort()
            abort.current?.abort()
        }
    }, [url, site])
    useEffect(() => { if (op?.auth) saveAuth(site, auth) }, [op, site, auth])

    const chosen = op?.servers[server]
    const base = op ? serverUrl(chosen, variables, window.location.origin) : ''
    const schemes = useMemo(() => op?.auth?.[option] ?? [], [op, option])
    const draft = useMemo(() => (op ? buildRequest(op, base, values, body, [authHook(schemes, auth), ...requestHooks], files) : null), [op, base, values, body, schemes, auth, files])
    const command = useMemo(() => (op ? curl(buildRequest(op, base, values, body, [authHook(schemes, auth, !reveal), ...requestHooks], files)) : ''),
        [op, base, values, body, schemes, auth, reveal, files])

    async function send(event: FormEvent) {
        event.preventDefault()
        if (!op || !draft) return
        const empty = missing(op, values)
        const problem = empty.length ? `Fill in ${empty.join(', ')}.` : bodyProblem(draft)
        if (problem) return setResult({ error: problem })
        const controller = (abort.current = new AbortController())
        setSending(true)
        setResult(null)
        const start = performance.now()
        try {
            const res = await fetch(...fetchArgs(draft, controller.signal))
            const type = res.headers.get('content-type') ?? ''
            const head = { status: res.status, statusText: res.statusText, headers: [...res.headers.entries()], type }
            const stream = isStream(type)
            let text = '', size = 0, note = ''
            try {
                const end = await readBody(res, (t, n) => {
                    text = t
                    size = n
                    if (stream) setResult({ ...head, ms: Math.round(performance.now() - start), size, body: text, live: true })
                })
                if (end === 'capped') note = `Stopped at ${byteSize(STREAM_CAP)}.`
            } catch {
                note = controller.signal.aborted ? 'Stopped.' : 'Stream interrupted.'
            }
            setResult({ ...head, ms: Math.round(performance.now() - start), size, body: note ? text : prettyBody(text, type), note })
        } catch (err) {
            setResult({
                error: controller.signal.aborted ? 'Request cancelled.'
                    : `The request did not reach the API (${(err as Error).message}). If the same request works with curl, the API does not allow calls from this site (CORS) or the server URL is wrong.`,
            })
        } finally {
            setSending(false)
        }
    }

    return createPortal(
        <dialog ref={dialog} className="aiui-try" aria-labelledby="aiui-try-title" onClose={onClose}
            onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}>
            <div className="aiui-try-head">
                <span className="aiui-endpoint-method" data-method={method}>{method}</span>
                <span id="aiui-try-title" className="aiui-try-title">{path}</span>
                <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => dialog.current?.close()}><X /></Button>
            </div>
            {!op ? (
                <div className="aiui-try-status" role="status">
                    {loadError ? 'The request form could not be loaded. Reload the page to try again.' : <><Spinner /> Opening the request form</>}
                </div>
            ) : (
                <div className="aiui-try-body">
                    <form className="aiui-try-form" onSubmit={send} noValidate>
                        <fieldset>
                            <legend>Server</legend>
                            {op.servers.length > 1 && (
                                <select className="aiui-try-select" aria-label="Server" value={server} onChange={(e) => {
                                    setServer(Number(e.target.value))
                                    setVariables(initialVariables(op.servers[Number(e.target.value)]))
                                }}>
                                    {op.servers.map((s, i) => <option key={s.url} value={i}>{s.description ? `${s.description}: ${s.url}` : s.url}</option>)}
                                </select>
                            )}
                            <code className="aiui-try-base">{base}</code>
                            {Object.entries(chosen?.variables ?? {}).map(([name, v]) => (
                                <Field key={name} id={`aiui-try-var-${name}`} label={name} hint="server variable" options={v.enum} required
                                    value={variables[name] ?? ''} onChange={(value) => setVariables((old) => ({ ...old, [name]: value }))} />
                            ))}
                        </fieldset>
                        {GROUPS.map(([where, legend]) => op.params.some((p) => p.in === where) && (
                            <fieldset key={where}>
                                <legend>{legend}</legend>
                                {where === 'cookie' && <p className="aiui-try-hint">A browser sends only the cookies it holds for the API&apos;s site; these values go in the curl command.</p>}
                                {op.params.filter((p) => p.in === where).map((p) => (
                                    <Field key={paramKey(p)} id={`aiui-try-${paramKey(p)}`} label={p.name} hint={p.type} required={p.required}
                                        options={p.array ? undefined : p.enum} value={values[paramKey(p)] ?? ''}
                                        onChange={(v) => setValues((old) => ({ ...old, [paramKey(p)]: v }))} />
                                ))}
                            </fieldset>
                        ))}
                        {!!op.auth?.length && (
                            <fieldset>
                                <legend>Authorization</legend>
                                <p className="aiui-try-hint">Kept in this browser tab only and sent only with this request.</p>
                                {op.auth.length > 1 && (
                                    <select className="aiui-try-select" aria-label="Authorization method" value={option} onChange={(e) => setOption(Number(e.target.value))}>
                                        {op.auth.map((o, i) => <option key={i} value={i}>{o.map((s) => s.id).join(' + ') || 'None'}</option>)}
                                    </select>
                                )}
                                {schemes.map((s) => (
                                    <div key={s.id} className="aiui-try-scheme">
                                        {authInputs(s).map(([key, label]) => (
                                            <Field key={key} id={`aiui-try-auth-${key}`} label={label} hint={schemeHint(s)} secret={!reveal}
                                                value={auth[key] ?? ''} onChange={(v) => setAuth((old) => ({ ...old, [key]: v }))} />
                                        ))}
                                        {s.scopes?.length ? <p className="aiui-try-hint">Scopes: {s.scopes.join(', ')}</p> : null}
                                    </div>
                                ))}
                                {!!schemes.length && (
                                    <Button type="button" variant="ghost" size="sm" className="aiui-try-reveal" aria-pressed={reveal} onClick={() => setReveal((r) => !r)}>
                                        {reveal ? 'Hide values' : 'Show values'}
                                    </Button>
                                )}
                            </fieldset>
                        )}
                        {op.body && (
                            <fieldset>
                                <legend>Body <span className="aiui-try-type">{op.body.type}</span></legend>
                                {op.body.file ? (
                                    <FileField id="aiui-try-body-file" label="File" hint={op.body.type} onChange={(f) => setFiles({ '': f })} />
                                ) : (
                                    <textarea className="aiui-try-code" aria-label="Request body" rows={10} spellCheck={false}
                                        placeholder={op.body.example} value={body} onChange={(e) => setBody(e.target.value)} />
                                )}
                                {op.body.files?.map((name) => (
                                    <FileField key={name} id={`aiui-try-file-${name}`} label={name} hint="file" onChange={(f) => setFiles((old) => ({ ...old, [name]: f }))} />
                                ))}
                                {Object.entries(op.body.base64 ?? {}).map(([name, encoding]) => (
                                    <FileField key={name} id={`aiui-try-file-${name}`} label={name} hint={`file as ${encoding}`}
                                        onChange={(f) => f && void encodeFile(f, encoding).then((v) => setBody((old) => withField(old, name, v)))} />
                                ))}
                            </fieldset>
                        )}
                        <div className="aiui-try-actions">
                            {sending ? <Button type="button" variant="outline" onClick={() => abort.current?.abort()}>{result && 'live' in result ? 'Stop' : 'Cancel'}</Button> : <Button type="submit">Send</Button>}
                        </div>
                    </form>
                    <div className="aiui-try-out">
                        <section aria-label="Request">
                            <div className="aiui-try-out-head">
                                <span>Request</span>
                                <Button variant="ghost" size="icon-sm" aria-label={copied ? 'Copied' : 'Copy as curl'} onClick={() => void copy(command).then((ok) => {
                                    setCopied(ok)
                                    setTimeout(() => setCopied(false), 1500)
                                })}>{copied ? <Check /> : <ClipboardCopy />}</Button>
                            </div>
                            <pre className="aiui-try-code">{command}</pre>
                        </section>
                        <section aria-label="Response" aria-live="polite" aria-busy={sending}>
                            <div className="aiui-try-out-head"><span>Response</span>
                                {result && 'status' in result && (
                                    <span className="aiui-try-meta">
                                        <span className="aiui-try-code-pill" data-tone={String(result.status)[0]}>{result.status} {result.statusText}</span>
                                        <span>{result.ms} ms</span><span>{byteSize(result.size)}</span>
                                    </span>
                                )}
                            </div>
                            {sending && !result && <p className="aiui-try-hint" role="status"><Spinner /> Waiting for the response</p>}
                            {!sending && !result && <p className="aiui-try-hint">Send the request to see the response here.</p>}
                            {result && 'error' in result && <p className="aiui-try-error" role="alert">{result.error}</p>}
                            {result && 'status' in result && <Response result={result} />}
                        </section>
                    </div>
                </div>
            )}
        </dialog>,
        document.body,
    )
}
