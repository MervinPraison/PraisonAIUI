/**
 * The Connect page's data and logic, kept out of the component so it is
 * tested on its own: the /api/connect shapes, the client rail groups, the
 * `?client=` preselection, the scope picker's groups and per-client tool
 * caps, the connected-clients rows with what to do about each, and the
 * one-click launcher that tells "the app opened" from "no app took the link".
 */

export interface ConnectClient {
  id: string
  label: string
  group: 'editor' | 'terminal' | 'other'
  deeplink: string | null
  command: string | null
  snippet: string
  config_path: string | null
  env_reference: boolean
  download: string
  docs: string
  note: string
  max_tools?: number | null
}

export interface ClientStatus {
  status: 'connected' | 'installed' | 'not installed'
  last_active?: number | null
  plaintext_secrets?: string[]
}

export interface Connection {
  name: string
  version?: string
  client_id?: string | null
  first_seen?: number
  last_active?: number
  sessions?: number
  transport?: string
}

export interface ConnectData {
  available: boolean
  install?: string
  server?: { name?: string; command?: string; args?: string[]; url?: string; transport?: string } | null
  scopable?: boolean
  scope?: string[]
  clients?: ConnectClient[]
  status?: Record<string, ClientStatus>
  connections?: Connection[]
}

export interface ToolsData {
  ok: boolean
  tools: string[]
  count: number
  server?: string
  error?: string
}

export const GROUPS: readonly [ConnectClient['group'], string][] = [
  ['editor', 'Editors'],
  ['terminal', 'Terminal'],
  ['other', 'Other'],
]

/** Clients by rail group, in catalog order; installed ones first within a group. */
export function groupClients(clients: readonly ConnectClient[], status: Record<string, ClientStatus> = {}) {
  const RANK: Record<string, number> = { connected: 0, installed: 1 }
  const rank = (c: ConnectClient) => RANK[status[c.id]?.status ?? ''] ?? 2
  return GROUPS.map(([id, label]) => ({
    id,
    label,
    clients: clients.filter((c) => c.group === id).map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map(({ c }) => c),
  })).filter((g) => g.clients.length > 0)
}

/** The client named by `?client=` (or `?ide=`), else the first one already connected or installed. */
export function initialClient(search: string, clients: readonly ConnectClient[], status: Record<string, ClientStatus> = {}): string | null {
  const q = new URLSearchParams(search)
  const wanted = q.get('client') ?? q.get('ide')
  if (wanted && clients.some((c) => c.id === wanted)) return wanted
  const ready = clients.find((c) => status[c.id]?.status === 'connected') ?? clients.find((c) => status[c.id]?.status === 'installed')
  return ready?.id ?? clients[0]?.id ?? null
}

/** `search` with `client` set to `id` (other params kept). */
export function withClient(search: string, id: string): string {
  const q = new URLSearchParams(search)
  q.delete('ide')
  q.set('client', id)
  return `?${q.toString()}`
}

/** The scope picker's groups: your agents (`ask_*`, `list_agents`) and the other tools. */
export function toolGroups(tools: readonly string[]): { agents: string[]; tools: string[] } {
  const agents = tools.filter((t) => t.startsWith('ask_') || t === 'list_agents')
  return { agents, tools: tools.filter((t) => !agents.includes(t)) }
}

/** "Copilot reads at most 128 tools" when the chosen scope is larger than the client takes. */
export function capWarning(client: ConnectClient | undefined, chosen: number): string | null {
  const cap = client?.max_tools
  return cap && chosen > cap ? `${client.label} reads at most ${cap} tools; ${chosen} are chosen. Pick fewer below.` : null
}

export type RowTone = 'ok' | 'warn' | 'bad' | 'idle'

export interface ConnectionRow {
  key: string
  clientId: string | null
  name: string
  version: string
  tone: RowTone
  status: string
  lastActive: number | null
  /** What is wrong and what fixes it; null when nothing needs doing. */
  fix: string | null
}

/**
 * One row per client that connected (the server's `clientInfo` ledger), plus
 * one per client whose config has our entry but that has never connected.
 * A config holding a plain-text key needs attention whatever else is true.
 */
export function connectionRows(data: ConnectData, labels: Record<string, string>): ConnectionRow[] {
  const status = data.status ?? {}
  const rows: ConnectionRow[] = []
  const seen = new Set<string>()
  for (const c of data.connections ?? []) {
    const id = c.client_id ?? null
    if (id) seen.add(id)
    const secrets = id ? status[id]?.plaintext_secrets ?? [] : []
    const removed = id ? status[id] && status[id].status !== 'connected' : false
    rows.push({
      key: `seen:${c.name}`,
      clientId: id,
      name: (id && labels[id]) || c.name,
      version: c.version ?? '',
      tone: secrets.length ? 'bad' : removed ? 'idle' : 'ok',
      status: removed ? 'Was connected; its config no longer has PraisonAI' : `Connected${c.sessions ? ` · ${c.sessions} session${c.sessions === 1 ? '' : 's'}` : ''}`,
      lastActive: c.last_active ? c.last_active * 1000 : null,
      fix: secrets.length ? `Plain-text key in its config (${secrets.join(', ')}). Reconnect to replace it with an env reference.` : removed ? 'Connect it again from the list.' : null,
    })
  }
  for (const [id, s] of Object.entries(status)) {
    if (seen.has(id) || s.status !== 'connected') continue
    const secrets = s.plaintext_secrets ?? []
    rows.push({
      key: `config:${id}`,
      clientId: id,
      name: labels[id] ?? id,
      version: '',
      tone: secrets.length ? 'bad' : 'warn',
      status: 'Configured, not used yet',
      lastActive: null,
      fix: secrets.length
        ? `Plain-text key in its config (${secrets.join(', ')}). Reconnect to replace it with an env reference.`
        : `Restart ${labels[id] ?? id} so it loads the server, then ask it to use a PraisonAI tool.`,
    })
  }
  const order: Record<RowTone, number> = { bad: 0, warn: 1, ok: 2, idle: 3 }
  return rows.sort((a, b) => order[a.tone] - order[b.tone] || (b.lastActive ?? 0) - (a.lastActive ?? 0))
}

export type LaunchResult = 'opened' | 'missing' | 'web'

/**
 * Open an install link. An https link opens in a new tab. A custom scheme
 * (cursor://, vscode:…) goes to the OS: if the window loses focus or the
 * page is hidden within `timeoutMs`, an app took it ("opened"); otherwise no
 * app is registered for the scheme ("missing"), and the page offers the
 * download.
 */
export function launch(url: string, timeoutMs = 2000, win: Window = window, doc: Document = document): Promise<LaunchResult> {
  if (/^https?:/i.test(url)) {
    win.open(url, '_blank', 'noopener,noreferrer')
    return Promise.resolve('web')
  }
  return new Promise((resolve) => {
    let done = false
    const finish = (r: LaunchResult) => {
      if (done) return
      done = true
      win.clearTimeout(timer)
      win.removeEventListener('blur', onLeave)
      doc.removeEventListener('visibilitychange', onHide)
      resolve(r)
    }
    const onLeave = () => finish('opened')
    const onHide = () => doc.visibilityState === 'hidden' && finish('opened')
    win.addEventListener('blur', onLeave)
    doc.addEventListener('visibilitychange', onHide)
    const timer = win.setTimeout(() => finish('missing'), timeoutMs)
    try {
      win.location.assign(url)
    } catch {
      finish('missing')
    }
  })
}
