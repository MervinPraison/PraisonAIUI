/**
 * Connect (builtin.connect): put this app's MCP server in Cursor, VS Code,
 * Claude, Codex and the rest. A rail of clients (Editors / Terminal / Other,
 * each with what this machine has), the chosen client's one-click link with
 * missing-app detection, the `praisonai connect` command that writes and
 * checks the config, the client's own command and the manual snippet, a
 * tool and agent scope picker that rewrites all of them, and the clients
 * that actually connected, with what to fix. `?client=<id>` preselects.
 * Data: /api/connect and /api/connect/tools (features/connect.py).
 */
import { useMemo, useState, type ReactNode } from 'react'
// Only icons the chat route does not import: a shared one would be split into a
// chunk of its own on the chat's first screen (R10).
import { ClipboardCheck, ClipboardCopy, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { notify } from '@/sdk/notify'
import { ago, fullTime, useJson, useNow, type Tone } from '../shared'
import { PageBody, Pill, Section, StatusDot } from '../ui'
import { Modal, ModalActions } from '../Modal'
import { capWarning, connectionRows, groupClients, initialClient, launch, toolGroups, withClient, type ConnectClient, type ConnectData, type ToolsData } from './model'

const STATUS: Record<string, [Tone, string]> = { connected: ['ok', 'Connected'], installed: ['info', 'Installed'], 'not installed': ['idle', 'Not found'] }

function CopyBox({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const copy = () =>
    navigator.clipboard.writeText(value).then(
      () => (setCopied(true), window.setTimeout(() => setCopied(false), 1500)),
      () => void notify('Could not copy: select the text instead', { type: 'error' }),
    )
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`}>
          {copied ? <ClipboardCheck aria-hidden /> : <ClipboardCopy aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="m-0 max-h-56 overflow-auto rounded-md border border-hairline bg-muted px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all text-foreground">{value}</pre>
      {hint && <p className="m-0 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function ScopePicker({ tools, chosen, onChange, warning }: { tools: ToolsData | null; chosen: string[] | null; onChange(next: string[] | null): void; warning: string | null }) {
  if (!tools) return <Skeleton className="h-16 w-full" />
  if (!tools.ok) return <p className="m-0 text-sm text-muted-foreground">Could not list the server's tools: {tools.error}</p>
  const groups = toolGroups(tools.tools)
  const on = new Set(chosen ?? tools.tools)
  const toggle = (name: string) => {
    const next = on.has(name) ? [...on].filter((t) => t !== name) : [...on, name]
    onChange(next.length === tools.tools.length ? null : next)
  }
  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={chosen === null} onCheckedChange={(all) => onChange(all ? null : groups.agents.length ? groups.agents : tools.tools.slice(0, 10))} aria-label="Expose every tool" />
        Every tool ({tools.count})
      </label>
      {warning && <p role="status" className="m-0 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">{warning}</p>}
      {chosen !== null && (
        <div className="grid max-h-72 gap-4 overflow-auto rounded-md border border-hairline p-3 sm:grid-cols-2">
          {([['Your agents', groups.agents], ['Tools', groups.tools]] as const).map(([title, names]) =>
            names.length ? (
              <fieldset key={title} className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
                <legend className="mb-1 text-xs font-medium text-muted-foreground">{title}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {names.map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={on.has(n)}
                      onClick={() => toggle(n)}
                      className={cn('h-7 max-w-full truncate rounded-full border px-2.5 font-mono text-2xs outline-none focus-visible:ring-2 focus-visible:ring-ring', on.has(n) ? 'border-transparent bg-accent-soft text-link' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground')}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null,
          )}
        </div>
      )}
    </div>
  )
}

function ClientPanel({ client, data, scopeFlag, onLaunch, opened }: { client: ConnectClient; data: ConnectData; scopeFlag: string; onLaunch(): void; opened: boolean }) {
  const st = data.status?.[client.id]
  const [tone, word] = STATUS[st?.status ?? ''] ?? ['idle', '']
  const cli = `praisonai connect ${client.id}${scopeFlag}`
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 text-lg font-semibold tracking-tight">{client.label}</h2>
        {word && <Pill tone={tone}>{word}</Pill>}
        <span className="flex-1" />
        <a className="inline-flex items-center gap-1 text-xs text-link hover:underline" href={client.docs} target="_blank" rel="noopener noreferrer">
          Setup docs
        </a>
      </div>
      {client.deeplink && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={onLaunch}>{opened ? `Open ${client.label} again` : `Install in ${client.label}`}</Button>
            <span className="text-xs text-muted-foreground">{data.scope?.length ? `${data.scope.length} tools chosen` : 'Every tool'} · no API key in the link</span>
          </div>
          {opened && <p role="status" className="m-0 text-sm text-muted-foreground">Sent to {client.label}. Confirm the install there.</p>}
        </div>
      )}
      {!data.server?.url && <CopyBox label="From a terminal: writes the config, keeps a backup, checks the tools" value={cli} hint={<>Undo with <code className="font-mono">{`praisonai connect ${client.id} --remove`}</code></>} />}
      {client.command && <CopyBox label={`${client.label}'s own command`} value={client.command} />}
      <CopyBox
        label="Manual setup"
        value={client.snippet}
        hint={[client.config_path && `Add to ${client.config_path}.`, client.env_reference ? 'Keys are env references, never values.' : '', client.note].filter(Boolean).join(' ')}
      />
    </div>
  )
}

function ConnectPage() {
  const [chosen, setChosen] = useState<string[] | null>(null)
  const url = chosen ? `/api/connect?tools=${encodeURIComponent(chosen.join(','))}` : '/api/connect'
  const res = useJson<ConnectData>(url, 30_000)
  const tools = useJson<ToolsData>(res.data?.available && res.data.scopable ? '/api/connect/tools' : null)
  const now = useNow(30_000)
  const data = res.data
  const clients = useMemo(() => data?.clients ?? [], [data])
  const [picked, setSelected] = useState<string | null>(null)
  const [opened, setOpened] = useState<Record<string, boolean>>({})
  const [missing, setMissing] = useState<ConnectClient | null>(null)

  // Until the user picks one: ?client=, else a client this machine already has.
  const selected = picked ?? (clients.length ? initialClient(window.location.search, clients, data?.status) : null)
  const pick = (id: string) => {
    setSelected(id)
    window.history.replaceState(window.history.state, '', withClient(window.location.search, id) + window.location.hash)
  }
  const client = clients.find((c) => c.id === selected)
  const labels = Object.fromEntries(clients.map((c) => [c.id, c.label]))
  const rows = data ? connectionRows(data, labels) : []
  const scopeFlag = chosen ? ` --tools '${chosen.join(',')}'` : ''
  const go = async (c: ConnectClient) => {
    if (!c.deeplink) return
    const r = await launch(c.deeplink)
    if (r === 'missing') setMissing(c)
    else setOpened((o) => ({ ...o, [c.id]: true }))
  }

  if (res.error && !data) {
    return (
      <PageBody>
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="m-0 text-sm">Could not load the clients: {res.error}</p>
          <Button size="sm" variant="outline" onClick={() => res.reload()}><RotateCw aria-hidden />Try again</Button>
        </div>
      </PageBody>
    )
  }
  if (!data) {
    return (
      <PageBody>
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading clients">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      </PageBody>
    )
  }
  if (!data.available) {
    return (
      <PageBody>
        <h1 className="m-0 text-xl font-semibold tracking-tight">Connect your editor</h1>
        <CopyBox label="Install PraisonAI's MCP server to connect Cursor, VS Code, Claude and 15 more" value={data.install ?? 'pip install praisonai-mcp'} hint="Then reload this page." />
      </PageBody>
    )
  }

  const server = data.server?.url ? data.server.url : 'This machine (stdio)'
  const count = tools.data?.ok ? `${chosen?.length ?? tools.data.count} tools` : ''
  return (
    <PageBody wide>
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-xl font-semibold tracking-tight">Connect your editor</h1>
        <p className="m-0 text-sm text-muted-foreground">
          Use your agents and tools from Cursor, VS Code, Claude, Codex and more. Server: <span className="text-foreground">{server}</span>
          {count && ` · ${count}`}
        </p>
      </header>
      <div className="grid min-w-0 gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Clients" className="flex min-w-0 gap-4 overflow-x-auto md:flex-col md:overflow-visible">
          {groupClients(clients, data.status).map((g) => (
            <div key={g.id} className="flex min-w-[11rem] flex-col gap-0.5">
              <h2 className="m-0 px-2 pb-1 text-2xs font-medium tracking-wide text-tier-3 uppercase">{g.label}</h2>
              {g.clients.map((c) => {
                const s = data.status?.[c.id]?.status
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-current={c.id === selected ? 'true' : undefined}
                    onClick={() => pick(c.id)}
                    className={cn('flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', c.id === selected ? 'bg-accent-soft text-link' : 'text-foreground hover:bg-muted')}
                  >
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    {s && s !== 'not installed' && <StatusDot tone={STATUS[s][0]}>{s === 'connected' ? 'On' : ''}</StatusDot>}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-8">
          {client && <ClientPanel client={client} data={data} scopeFlag={scopeFlag} opened={!!opened[client.id]} onLaunch={() => void go(client)} />}
          {data.scopable && (
            <Section title="Choose what it can use" meta="Applies to the link, the commands and the snippet">
              <ScopePicker tools={tools.data} chosen={chosen} onChange={setChosen} warning={capWarning(client, chosen?.length ?? tools.data?.count ?? 0)} />
            </Section>
          )}
          <Section title="Connected clients" meta={rows.length ? `${rows.filter((r) => r.tone === 'ok').length} active` : undefined}>
            {rows.length === 0 ? (
              <p className="m-0 text-sm text-muted-foreground">No client has connected yet. Install one above; it shows here after its first tool list.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col divide-y divide-hairline rounded-md border border-hairline p-0">
                {rows.map((r) => (
                  <li key={r.key} className="flex min-w-0 flex-wrap items-center gap-3 px-3 py-2.5">
                    <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-semibold">{r.name.charAt(0).toUpperCase()}</span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{r.name}{r.version && <span className="font-normal text-tier-3"> {r.version}</span>}</span>
                      <StatusDot tone={r.tone}>
                        {r.status}
                        {r.lastActive ? <span title={fullTime(r.lastActive)}>{` · last used ${ago(r.lastActive, now)}`}</span> : null}
                      </StatusDot>
                      {r.fix && <span className="text-xs text-muted-foreground">{r.fix}</span>}
                    </span>
                    {r.clientId && r.fix && <Button size="sm" variant="outline" onClick={() => pick(r.clientId!)}>Fix it</Button>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
      <Modal open={!!missing} onOpenChange={(o) => !o && setMissing(null)} title={`${missing?.label ?? 'The app'} did not open`} description={`No app on this device answered the link. Install ${missing?.label ?? 'it'}, then try again, or use the terminal command or manual setup.`}>
        <ModalActions>
          <Button variant="outline" onClick={() => (missing && void go(missing), setMissing(null))}>Try again</Button>
          {missing?.download && (
            <Button asChild>
              <a href={missing.download} target="_blank" rel="noopener noreferrer">Download {missing.label}</a>
            </Button>
          )}
        </ModalActions>
      </Modal>
    </PageBody>
  )
}

export default ConnectPage
