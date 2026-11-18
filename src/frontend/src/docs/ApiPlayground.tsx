// Try it: the request form an endpoint page opens from its endpoint bar
// (docs/ApiFields.tsx, lazy chunk). It reads the operation `aiui build`
// published (openapi/try/<page>.json), sends with fetch from the reader's
// browser (no proxy) and shows status, time, size, headers and body.
// Request logic: docs/playground.ts. Styles: docs/playground.css.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ClipboardCopy, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
    bodyProblem, buildRequest, byteSize, curl, fetchArgs, initialValues, initialVariables, missing, paramKey, prettyBody, requestHooks, serverUrl,
    type Operation,
} from './playground'
import './playground.css'

const GROUPS = [['path', 'Path parameters'], ['query', 'Query parameters'], ['header', 'Headers'], ['cookie', 'Cookies']] as const
const SHOWN = 200_000 // characters of a response body drawn
type Result = { status: number; statusText: string; ms: number; size: number; headers: [string, string][]; body: string } | { error: string }
type FieldProps = { id: string; label: string; hint?: string; required?: boolean; options?: string[]; value: string; onChange: (v: string) => void }

function Field({ id, label, hint, required, options, value, onChange }: FieldProps) {
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
            ) : <Input id={id} value={value} autoComplete="off" spellCheck={false} onChange={(e) => onChange(e.target.value)} />}
        </div>
    )
}

function Response({ result }: { result: Extract<Result, { status: number }> }) {
    return (
        <>
            <details className="aiui-try-headers">
                <summary>Headers ({result.headers.length})</summary>
                <dl>{result.headers.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
            </details>
            <pre className="aiui-try-code">{result.body.slice(0, SHOWN) || 'Empty body'}</pre>
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
            }, () => !controller.signal.aborted && setLoadError(true))
        return () => {
            controller.abort()
            abort.current?.abort()
        }
    }, [url])

    const chosen = op?.servers[server]
    const base = op ? serverUrl(chosen, variables, window.location.origin) : ''
    const draft = useMemo(() => (op ? buildRequest(op, base, values, body, requestHooks) : null), [op, base, values, body])
    const command = draft ? curl(draft) : ''

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
            const text = await res.text()
            setResult({
                status: res.status, statusText: res.statusText, ms: Math.round(performance.now() - start),
                size: new Blob([text]).size, headers: [...res.headers.entries()], body: prettyBody(text, res.headers.get('content-type')),
            })
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
                        {op.body && (
                            <fieldset>
                                <legend>Body <span className="aiui-try-type">{op.body.type}</span></legend>
                                <textarea className="aiui-try-code" aria-label="Request body" rows={10} spellCheck={false}
                                    placeholder={op.body.example} value={body} onChange={(e) => setBody(e.target.value)} />
                            </fieldset>
                        )}
                        <div className="aiui-try-actions">
                            {sending ? <Button type="button" variant="outline" onClick={() => abort.current?.abort()}>Cancel</Button> : <Button type="submit">Send</Button>}
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
                            {sending && <p className="aiui-try-hint" role="status"><Spinner /> Waiting for the response</p>}
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
