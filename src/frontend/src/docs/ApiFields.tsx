// API reference blocks: <ParamField> and <ResponseField> rows, <Expandable>
// nested properties and the panels (<Panel>, <RequestExample>,
// <ResponseExample>) that docs/panels.ts moves to the page's side column.
// The tags become aiui-field / aiui-expandable / aiui-panel (markdown/docsTags.ts).
// Styles: docs/docs.css (.aiui-field*, .aiui-expandable*, .aiui-panel).
import { createContext, lazy, Suspense, useContext, useState, type ReactNode } from 'react'
import { Check, ChevronRight, ClipboardCopy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { withBase } from '@/lib/url'
import { slugify } from '../markdown/slug'
import { copyText } from './pageActionLinks'

const loadPlayground = () => import('./ApiPlayground')
const ApiPlayground = lazy(loadPlayground)

type FieldProps = {
    field?: string; at?: string; type?: string; req?: string; dep?: string
    dflt?: string; hint?: string; pre?: string; post?: string; anchor?: string; children?: ReactNode
}

/** The anchor of the field a nested field sits in: `#response-user-address-city`. */
const ParentField = createContext('')

const Pills = ({ list }: { list?: string }) => list?.split(',').map((label) => <span key={label} className="aiui-field-pill">{label}</span>)

export function ApiField({ field, at = 'param', type, req, dep, dflt, hint, pre, post, anchor, children }: FieldProps) {
    const parent = useContext(ParentField)
    const slug = field ? slugify(field) : ''
    const id = anchor ?? (slug ? `${parent || (at === 'response' ? 'response' : 'param')}-${slug}` : undefined)
    return (
        <div className="aiui-field" id={id} data-at={at} data-placeholder={hint} data-deprecated={dep ? '' : undefined}>
            <div className="aiui-field-head">
                <Pills list={pre} />
                {field && (id ? <a className="aiui-field-name" href={`#${id}`}>{field}</a> : <span className="aiui-field-name">{field}</span>)}
                {type && <span className="aiui-field-type">{type}</span>}
                {at !== 'param' && at !== 'response' && <span className="aiui-field-pill">{at}</span>}
                {req && <span className="aiui-field-pill" data-tone="required">required</span>}
                {dep && <span className="aiui-field-pill" data-tone="deprecated">deprecated</span>}
                <Pills list={post} />
                {dflt !== undefined && (
                    <span className="aiui-field-default">
                        default: <code>{dflt}</code>
                    </span>
                )}
            </div>
            <div className="aiui-field-body">
                <ParentField.Provider value={id ?? parent}>{children}</ParentField.Provider>
            </div>
        </div>
    )
}

/** Nested properties: a native disclosure ("Show properties" / "Hide properties"), closed unless `defaultOpen`. */
export function Expandable({ title = 'properties', opened, children }: { title?: string; opened?: string; children?: ReactNode }) {
    return (
        <details className="aiui-expandable" open={opened === 'true'}>
            <summary>
                <ChevronRight aria-hidden="true" />
                <span className="aiui-expandable-show">Show {title}</span>
                <span className="aiui-expandable-hide">Hide {title}</span>
            </summary>
            <div className="aiui-expandable-body">{children}</div>
        </details>
    )
}

const PANEL_LABEL: Record<string, string> = { request: 'Request example', response: 'Response example' }

/** One block of the side column; inline where docs/panels.ts leaves it (inside a list item). */
export function Panel({ kind, children }: { kind?: string; children?: ReactNode }) {
    const label = kind ? PANEL_LABEL[kind] : undefined
    return label
        ? <section className="aiui-panel" data-kind={kind} aria-label={label}>{children}</section>
        : <div className="aiui-panel">{children}</div>
}

/**
 * <ApiPlayground method path src>: the endpoint bar under an endpoint page's title
 * (compiler/openapi_pages.py). With `src` (display `interactive`), Try it opens the
 * request form, a lazy chunk fetched on first hover, focus or click.
 */
export function Endpoint({ method = 'GET', path = '', src }: { method?: string; path?: string; src?: string }) {
    const [open, setOpen] = useState(false)
    const [copied, setCopied] = useState(false)
    return (
        <div className="aiui-endpoint">
            <span className="aiui-endpoint-method" data-method={method}>{method}</span>
            <code className="aiui-endpoint-path">{path}</code>
            <Button variant="ghost" size="icon-sm" aria-label={copied ? 'Copied' : 'Copy path'} onClick={() => void copyText(path).then((ok) => {
                setCopied(ok)
                setTimeout(() => setCopied(false), 1500)
            })}>{copied ? <Check /> : <ClipboardCopy />}</Button>
            {src && (
                <Button size="sm" onPointerEnter={() => void loadPlayground()} onFocus={() => void loadPlayground()} onClick={() => setOpen(true)}>
                    Try it
                </Button>
            )}
            {open && src && (
                <Suspense fallback={null}>
                    <ApiPlayground url={withBase(src)} method={method} path={path} copy={copyText} onClose={() => setOpen(false)} />
                </Suspense>
            )}
        </div>
    )
}
