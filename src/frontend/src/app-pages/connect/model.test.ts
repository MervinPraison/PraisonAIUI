// The Connect page's logic (app-pages/connect/model.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { capWarning, connectionRows, groupClients, initialClient, launch, toolGroups, withClient, type ConnectClient } from './model'

const client = (id: string, group: ConnectClient['group'], extra: Partial<ConnectClient> = {}): ConnectClient => ({
  id, label: id.toUpperCase(), group, deeplink: null, command: null, snippet: '{}', config_path: null,
  env_reference: true, download: `https://dl/${id}`, docs: '', note: '', ...extra,
})
const CLIENTS = [client('cursor', 'editor'), client('zed', 'editor'), client('codex', 'terminal'), client('any', 'other')]

test('connect: groups the rail and puts what this machine has first', () => {
  const g = groupClients(CLIENTS, { zed: { status: 'connected' } })
  assert.deepEqual(g.map((x) => x.label), ['Editors', 'Terminal', 'Other'])
  assert.deepEqual(g[0].clients.map((c) => c.id), ['zed', 'cursor'])
})

test('connect: preselects from ?client= (or ?ide=), else a connected or installed client', () => {
  assert.equal(initialClient('?client=codex', CLIENTS), 'codex')
  assert.equal(initialClient('?ide=zed', CLIENTS), 'zed')
  assert.equal(initialClient('?client=nope', CLIENTS, { codex: { status: 'installed' } }), 'codex')
  assert.equal(initialClient('', CLIENTS), 'cursor')
  assert.equal(withClient('?ide=zed&x=1', 'cursor'), '?x=1&client=cursor')
})

test('connect: splits agents from tools and warns past a client cap', () => {
  assert.deepEqual(toolGroups(['ask_support', 'list_agents', 'praisonai.memory.show']), { agents: ['ask_support', 'list_agents'], tools: ['praisonai.memory.show'] })
  const trae = client('trae', 'editor', { max_tools: 40 })
  assert.match(capWarning(trae, 85) ?? '', /at most 40 tools; 85/)
  assert.equal(capWarning(trae, 12), null)
  assert.equal(capWarning(undefined, 500), null)
})

test('connect: lists connected clients with what to fix, problems first', () => {
  const rows = connectionRows(
    {
      available: true,
      connections: [{ name: 'cursor-vscode', version: '2.1', client_id: 'cursor', last_active: 100, sessions: 3 }],
      status: { cursor: { status: 'connected' }, zed: { status: 'connected', plaintext_secrets: ['OPENAI_API_KEY'] }, codex: { status: 'connected' } },
    },
    { cursor: 'Cursor', zed: 'Zed', codex: 'Codex CLI' },
  )
  assert.deepEqual(rows.map((r) => [r.name, r.tone]), [['Zed', 'bad'], ['Codex CLI', 'warn'], ['Cursor', 'ok']])
  assert.match(rows[0].fix ?? '', /Plain-text key .*OPENAI_API_KEY/)
  assert.match(rows[1].fix ?? '', /Restart Codex CLI/)
  assert.equal(rows[2].status, 'Connected · 3 sessions')
  assert.equal(rows[2].lastActive, 100_000)
  assert.equal(rows[2].fix, null)
})

test('connect: launch: blur within 2 s means the app opened, silence means it is missing', async () => {
  let fire: () => void = () => {}
  const assigned: string[] = []
  const opened: unknown[][] = []
  const win = Object.assign(new EventTarget(), {
    setTimeout: (fn: () => void) => ((fire = fn), 1),
    clearTimeout: () => {},
    open: (...a: unknown[]) => void opened.push(a),
    location: { assign: (u: string) => void assigned.push(u) },
  }) as unknown as Window
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' }) as unknown as Document
  const first = launch('cursor://x', 2000, win, doc)
  win.dispatchEvent(new Event('blur'))
  assert.equal(await first, 'opened')
  assert.deepEqual(assigned, ['cursor://x'])
  const second = launch('vscode:mcp/install?x', 2000, win, doc)
  fire()
  assert.equal(await second, 'missing')
  assert.equal(await launch('https://kiro.dev/launch/mcp/add?x', 2000, win, doc), 'web')
  assert.deepEqual(opened, [['https://kiro.dev/launch/mcp/add?x', '_blank', 'noopener,noreferrer']])
})
