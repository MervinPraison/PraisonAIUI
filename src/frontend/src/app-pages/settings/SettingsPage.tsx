/**
 * Settings (ProSettings.dc.html), the app shell's page for `config` inside a
 * layout: a section list on the left (chips on a phone), a breadcrumb and
 * the section's fields, each with plain-language help, shadcn controls
 * (Select, Switch, Input), a masked API key with a show toggle and Test
 * connection, a search ("/"), and a sticky "Unsaved changes" bar with
 * Discard and Save (validated, then applied).
 *
 * Data: GET /api/config/schema, /api/config/runtime, /api/config/defaults;
 * POST /api/config/validate and /api/config/apply; GET /api/provider/health
 * for Test connection.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, PlugZap } from 'lucide-react'
import { TemplateSearch } from '@/components/page/parts'
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { fetchJson } from '@/sdk/services'
import { inLayoutOnly, StatusDot, useJson, type AppPageProps, type Tone } from '../shared'
import { changedPaths, matchField, setPath, settingsSections, valueOf, type Config, type SettingsField } from './model'

type Health = { status?: string; provider?: string; detail?: string; api_key?: string }

function SettingsPage({ page }: AppPageProps) {
  // One name everywhere: the page's own title (the nav and the top bar say the same).
  const pageName = page.title || 'Settings'
  const schema = useJson<{ schema?: unknown }>('/api/config/schema')
  const runtime = useJson<{ config?: Config }>('/api/config/runtime')
  const defaults = useJson<{ defaults?: Config }>('/api/config/defaults')
  // The same source as Overview's provider card and the chat's setup banner.
  const health = useJson<Health>('/api/provider/health')
  const sections = useMemo(() => settingsSections(schema.data?.schema), [schema.data])
  const defs = useMemo(() => defaults.data?.defaults ?? {}, [defaults.data])

  const [saved, setSaved] = useState<Config>({})
  const [draft, setDraft] = useState<Config>({})
  useEffect(() => {
    const cfg = runtime.data?.config ?? {}
    setSaved(cfg)
    setDraft(cfg)
  }, [runtime.data])

  const [active, setActive] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  const section = sections.find((s) => s.id === active) ?? sections[0]
  const changed = useMemo(() => changedPaths(sections, saved, draft), [sections, saved, draft])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      searchRef.current?.querySelector('input')?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const v = await fetchJson<{ valid?: boolean; errors?: unknown[] }>('/api/config/validate', { method: 'POST', body: { config: draft } })
      if (v.valid === false) {
        setMessage({ tone: 'bad', text: `Not saved: ${(v.errors ?? []).map(String).join('; ') || 'the values are not valid'}` })
        return
      }
      const r = await fetchJson<{ applied?: boolean; errors?: unknown[] }>('/api/config/apply', { method: 'POST', body: { config: draft } })
      if (r.applied === false) {
        setMessage({ tone: 'bad', text: `Not saved: ${(r.errors ?? []).map(String).join('; ') || 'the server refused the change'}` })
        return
      }
      setSaved(draft)
      setMessage({ tone: 'ok', text: 'Saved. Some server settings take effect after a restart.' })
    } catch (e) {
      setMessage({ tone: 'bad', text: `Not saved: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setSaving(false)
    }
  }

  const searching = query.trim() !== ''
  const visible = searching
    ? sections.map((s) => ({ ...s, fields: s.fields.filter((f) => matchField(f, query)) })).filter((s) => s.fields.length)
    : section
      ? [section]
      : []

  if (schema.loading || runtime.loading) {
    return <p className="m-0 p-6 text-sm text-muted-foreground">Loading settings…</p>
  }
  if (!sections.length) {
    return (
      <p role="alert" className="m-0 p-6 text-sm text-muted-foreground">
        This server publishes no settings{schema.error ? ` (${schema.error})` : ''}.
      </p>
    )
  }

  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col" data-aiui-app-page="settings">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        {/* The section nav runs the full height, so its divider does too. */}
        <nav aria-label="Settings sections" className="shrink-0 border-b border-border md:w-56 md:border-r md:border-b-0">
          <ul className="m-0 flex list-none gap-1 overflow-x-auto p-2 md:flex-col md:p-3">
            {sections.map((s) => {
              const current = !searching && s.id === section?.id
              const dirty = changed.some((p) => p.startsWith(`${s.id}.`))
              return (
                <li key={s.id} className="shrink-0">
                  <button
                    type="button"
                    aria-current={current ? 'page' : undefined}
                    onClick={() => {
                      setActive(s.id)
                      setQuery('')
                    }}
                    className={cn(
                      'flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      current ? 'bg-accent-soft font-medium text-link' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    {dirty && <span aria-label="changed" className="size-1.5 rounded-full bg-warning" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="flex w-full max-w-3xl flex-col gap-6 px-4 py-5 sm:px-8 sm:py-6">
            <div className="flex flex-wrap items-center gap-3">
              <Breadcrumb className="min-w-0 flex-1">
                <BreadcrumbList>
                  <BreadcrumbItem>{pageName}</BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{searching ? 'Search' : section?.title}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
              <div ref={searchRef} className="w-full sm:w-64">
                <TemplateSearch label="Search settings" value={query} onChange={setQuery} placeholder="Search settings" shortcut="/" />
              </div>
            </div>
            {visible.length === 0 && <p className="m-0 text-sm text-muted-foreground">No setting matches “{query}”.</p>}
            {visible.map((s) => (
              <section key={s.id} aria-labelledby={`settings-${s.id}`} className="flex flex-col gap-1">
                <h2 id={`settings-${s.id}`} className="m-0 text-xl font-semibold tracking-tight">
                  {s.title}
                </h2>
                {s.description && <p className="m-0 mb-3 text-sm text-muted-foreground">{s.description}</p>}
                {s.id === 'provider' && providerNote(health.data) && (
                  <p className="m-0 mb-3 text-sm text-muted-foreground" data-aiui-provider-note="">{providerNote(health.data)}</p>
                )}
                <div className="divide-y divide-border rounded-xl border border-border bg-card">
                  {s.fields.map((f) => (
                    <FieldRow
                      key={f.path}
                      field={f}
                      value={valueOf(draft, defs, f)}
                      dirty={changed.includes(f.path)}
                      envKey={f.path === 'provider.api_key' && health.data?.api_key === 'set'}
                      onChange={(v) => setDraft((d) => setPath(d, f.path, v))}
                    />
                  ))}
                  {s.id === 'provider' && <TestConnection />}
                </div>
              </section>
            ))}
            {message && (
              <p role={message.tone === 'bad' ? 'alert' : 'status'} className={cn('m-0 rounded-md px-3 py-2 text-sm', message.tone === 'bad' ? 'bg-danger-soft text-destructive' : 'bg-success-soft text-success')}>
                {message.text}
              </p>
            )}
          </div>
        </div>
      </div>
      {changed.length > 0 && (
        <div role="region" aria-label="Unsaved changes" className="sticky bottom-0 flex shrink-0 flex-wrap items-center gap-3 border-t border-border bg-card px-4 py-3 shadow-[var(--shadow-float,0_-4px_12px_rgb(0_0_0/0.06))] sm:px-6" data-aiui-unsaved="">
          <StatusDot tone="warn">
            Unsaved changes · {changed.length} {changed.length === 1 ? 'setting' : 'settings'}
          </StatusDot>
          <span className="flex-1" />
          <Button variant="outline" size="sm" disabled={saving} onClick={() => setDraft(saved)}>
            Discard
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Under the provider heading when chats are answered by another provider
 * (a custom gateway): these settings configure the built-in one only, so
 * Overview and Settings do not seem to disagree.
 */
export function providerNote(h: Health | null | undefined): string {
  const name = h?.provider
  return name && name !== 'PraisonAIProvider' ? `Chats are answered by ${name}. These settings apply to the built-in PraisonAI provider.` : ''
}

/** `envKey`: no key is saved here, but the server has one in its environment. */
function FieldRow({ field: f, value, dirty, envKey, onChange }: { field: SettingsField; value: unknown; dirty: boolean; envKey?: boolean; onChange(v: unknown): void }) {
  const id = `setting-${f.path.replace(/\./g, '-')}`
  const helpId = `${id}-help`
  const [shown, setShown] = useState(false)
  let control
  if (f.kind === 'select') {
    control = (
      <Select value={value == null ? undefined : String(value)} onValueChange={onChange}>
        <SelectTrigger id={id} aria-describedby={f.help ? helpId : undefined} className="w-full sm:w-64">
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          {f.options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  } else if (f.kind === 'switch') {
    control = <Switch id={id} aria-describedby={f.help ? helpId : undefined} checked={value === true} onCheckedChange={onChange} />
  } else if (f.kind === 'number') {
    control = (
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        aria-describedby={f.help ? helpId : undefined}
        className="w-full sm:w-40"
        min={f.schema.minimum}
        max={f.schema.maximum}
        step={f.schema.type === 'integer' ? 1 : 0.1}
        value={typeof value === 'number' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    )
  } else if (f.kind === 'secret') {
    const set = typeof value === 'string' && value !== ''
    control = (
      <div className="flex w-full flex-col gap-1.5 sm:w-64">
        <div className="relative">
          <Input
            id={id}
            type={shown ? 'text' : 'password'}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${f.help ? helpId : ''} ${id}-status`.trim()}
            className="pr-9 font-mono"
            placeholder="sk-…"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
            aria-label={shown ? `Hide ${f.title}` : `Show ${f.title}`}
            aria-pressed={shown}
            onClick={() => setShown((s) => !s)}
          >
            {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          </Button>
        </div>
        <span id={`${id}-status`}>
          <StatusDot tone={set || envKey ? 'ok' : 'idle'}>{set ? 'Saved here' : envKey ? 'From the environment' : 'Not set'}</StatusDot>
        </span>
      </div>
    )
  } else {
    control = (
      <Input
        id={id}
        aria-describedby={f.help ? helpId : undefined}
        className="w-full sm:w-64"
        value={typeof value === 'string' ? value : value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:gap-6" data-setting={f.path}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <label htmlFor={id} className="text-sm font-medium text-foreground">
            {f.title}
          </label>
          {dirty && <span className="text-2xs font-medium text-warning">Changed</span>}
        </div>
        {f.help && (
          <p id={helpId} className="m-0 mt-1 text-xs leading-relaxed text-muted-foreground">
            {f.help}
          </p>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

function TestConnection() {
  const [state, setState] = useState<{ tone: Tone; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const test = async () => {
    setBusy(true)
    try {
      const h = await fetchJson<Health>('/api/provider/health')
      const ok = /^(ok|healthy)$/i.test(h.status ?? '')
      setState({ tone: ok ? 'ok' : 'warn', text: ok ? `Works · ${h.provider ?? 'provider'} answered` : `${h.provider ?? 'Provider'}: ${h.detail || h.status || 'no answer'}` })
    } catch (e) {
      setState({ tone: 'bad', text: `No answer: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void test()}>
        <PlugZap aria-hidden />
        {busy ? 'Testing…' : 'Test connection'}
      </Button>
      <span role="status">{state && <StatusDot tone={state.tone}>{state.text}</StatusDot>}</span>
    </div>
  )
}

export default inLayoutOnly(SettingsPage)
