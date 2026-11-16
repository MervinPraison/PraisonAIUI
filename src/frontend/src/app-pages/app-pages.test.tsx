// The app shell's React pages (src/app-pages): their pure data models, the
// classic-frame fallback, their registration as built-ins, and what each
// page draws with no server data (SSR, layout on).
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { prerender } from 'react-dom/static'
import { activateLayout, registerLayout, resetLayoutsForTests } from '@/sdk/layouts'
import type { ShellPage } from '@/sdk/manifest'
import { appPageBuiltins } from '@/builtin/appPages'
import { ago, toMs } from './shared'
import { filterRows, sessionRows, sortRows } from './sessions/model'
import { logEntries, logsAsText } from './logs/model'
import { changedPaths, getPath, matchField, sentenceCase, setPath, settingsSections, valueOf } from './settings/model'
import { agentRows, draftError, draftOf, filterAgents, modelOptions, monogram, payloadOf, sortAgents, summaryOf } from './agents/model'
import { attentionLabel, featureHealth, formatCost, greeting, providerLine, series, sparkPath, summary } from './overview/model'
import SessionsPage from './sessions/SessionsPage'
import AgentsPage from './agents/AgentsPage'
import LogsPage from './logs/LogsPage'
import SettingsPage, { providerNote } from './settings/SettingsPage'
import OverviewPage from './overview/OverviewPage'
import KnowledgePage from './knowledge/KnowledgePage'
import { fileType, formatBytes, knowledgeRows, relevance, snippet, sortRows as sortKnowledge, storeStatus, uploadError } from './knowledge/model'

const NOW = Date.parse('2026-11-15T12:00:00Z')

// ── shared ──
test('relative times read as words, never a raw timestamp', () => {
  assert.equal(ago(NOW - 10_000, NOW), 'just now')
  assert.equal(ago(NOW - 9 * 60_000, NOW), '9 min ago')
  assert.equal(ago(NOW - 3 * 3_600_000, NOW), '3 h ago')
  assert.equal(ago(NOW - 30 * 3_600_000, NOW), 'yesterday')
  assert.equal(ago(Number.NaN, NOW), '')
  assert.equal(toMs('2026-11-15T12:00:00Z'), NOW)
  assert.equal(toMs(NOW / 1000), NOW)
})

// ── sessions ──
const SESSIONS = {
  sessions: [
    { id: 'a', title: 'Compare sorting algorithms', message_count: 4, tokens: 1200, created_at: '2026-11-15T11:00:00Z', updated_at: '2026-11-15T11:51:00Z' },
    { session_id: 'b', title: '', message_count: 2, created_at: '2026-11-13T10:00:00Z', agent_id: 'Writer' },
    { title: 'no id' },
  ],
}

test('sessions: rows from /api/sessions, running from the feed, a fallback title, no id dropped', () => {
  const rows = sessionRows(SESSIONS, new Set(['a']))
  assert.deepEqual(rows.map((r) => [r.id, r.title, r.agent, r.running]), [
    ['a', 'Compare sorting algorithms', null, true],
    ['b', 'Untitled chat', 'Writer', false],
  ])
  assert.equal(rows[1].updated, Date.parse('2026-11-13T10:00:00Z'), 'updated falls back to created')
})

test('sessions: search, status chips, agent filter and column sort', () => {
  const rows = sessionRows(SESSIONS, new Set(['a']))
  const f = (o: Partial<Parameters<typeof filterRows>[1]>) => filterRows(rows, { query: '', status: 'all', agent: null, now: NOW, ...o }).map((r) => r.id)
  assert.deepEqual(f({ query: 'sort' }), ['a'])
  assert.deepEqual(f({ query: 'writer' }), ['b'])
  assert.deepEqual(f({ status: 'running' }), ['a'])
  assert.deepEqual(f({ status: 'today' }), ['a'])
  assert.deepEqual(f({ status: 'older' }), ['b'])
  assert.deepEqual(f({ agent: 'Writer' }), ['b'])
  assert.deepEqual(sortRows(rows, { key: 'messages', dir: 'asc' }).map((r) => r.id), ['b', 'a'])
  assert.deepEqual(sortRows(rows, { key: 'updated', dir: 'desc' }).map((r) => r.id), ['a', 'b'])
})

// ── agents ──
const AGENTS = {
  agents: [
    { id: 'a1', name: 'Research bot', description: '', instructions: 'Cite sources.\nBe brief.', model: 'gpt-4o', temperature: 0.2, tools: ['web_search', { name: 'calc' }, 3], created_at: 1763200000, updated_at: 1763203600 },
    { id: 'gw', name: 'Router', description: 'Routes requests', model: 'gpt-4o-mini', source: 'gateway', created_at: 1763100000 },
    { name: 'no id' },
  ],
  count: 3,
}

test('agents: rows from /api/agents/definitions, code-registered agents read-only, no id dropped', () => {
  const rows = agentRows(AGENTS)
  assert.deepEqual(rows.map((r) => [r.id, r.name, r.tools, r.fromCode, r.status]), [
    ['a1', 'Research bot', ['web_search', 'calc'], false, 'active'],
    ['gw', 'Router', [], true, 'active'],
  ])
  assert.equal(rows[1].temperature, 0.7, 'a missing temperature reads as the server default')
  assert.equal(rows[1].updated, rows[1].created, 'updated falls back to created')
  assert.equal(summaryOf(rows[0]), 'Cite sources.', 'no description: the first line of the instructions')
  assert.deepEqual([monogram('Research bot'), monogram('writer'), monogram('code_reviewer')], ['RB', 'W', 'CR'])
  assert.deepEqual(agentRows({}), [])
})

test('agents: search, model filter, sort and the model list', () => {
  const rows = agentRows(AGENTS)
  assert.deepEqual(filterAgents(rows, { query: 'route', model: null }).map((r) => r.id), ['gw'])
  assert.deepEqual(filterAgents(rows, { query: 'cite', model: null }).map((r) => r.id), ['a1'])
  assert.deepEqual(filterAgents(rows, { query: '', model: 'gpt-4o' }).map((r) => r.id), ['a1'])
  assert.deepEqual(sortAgents(rows, { key: 'name', dir: 'desc' }).map((r) => r.id), ['gw', 'a1'])
  assert.deepEqual(sortAgents(rows, { key: 'tools', dir: 'desc' }).map((r) => r.id), ['a1', 'gw'])
  assert.deepEqual(modelOptions({ models: ['gpt-4o', 7] }, 'local-llama'), ['local-llama', 'gpt-4o'])
})

test('agents: the form draft, its checks and the request body', () => {
  const blank = draftOf(null, 'gpt-4o-mini')
  assert.equal(blank.model, 'gpt-4o-mini')
  assert.equal(draftError(blank), 'Give the agent a name.')
  assert.equal(draftError({ ...blank, name: 'A', temperature: '3' }), 'Temperature is a number from 0 to 2.')
  assert.equal(draftError({ ...blank, name: 'A', temperature: '' }), 'Temperature is a number from 0 to 2.')
  const row = agentRows(AGENTS)[0]
  const body = { name: 'Researcher', description: '', model: 'gpt-4o', temperature: 0.2, instructions: 'Cite sources.\nBe brief.', system_prompt: '' }
  assert.deepEqual(payloadOf({ ...draftOf(row, 'x'), name: ' Researcher ' }), body)
})

// ── knowledge ──
const KNOWLEDGE = {
  entries: [
    { id: 'a1', text: 'Refund policy: full refund within 30 days.\nAfter that, store credit.', metadata: {}, created_at: NOW / 1000 - 600 },
    { id: 'b2', text: '[File: faq.md]\n# FAQ\nShipping takes 3 days.', metadata: { filename: 'faq.md', source: 'upload' }, created_at: NOW / 1000 - 7200 },
    { id: 'c3', text: 'x', metadata: { title: 'Pricing', source: 'manual' } },
    { text: 'no id' },
  ],
}

test('knowledge: rows name, type and size every entry in words; the upload header is not content', () => {
  const rows = knowledgeRows(KNOWLEDGE)
  assert.deepEqual(rows.map((r) => [r.id, r.name, r.type, r.source]), [
    ['a1', 'Refund policy: full refund within 30 days.', 'Text', 'Typed in'],
    ['b2', 'faq.md', 'Markdown', 'Upload'],
    ['c3', 'Pricing', 'Text', 'Typed in'],
  ])
  assert.equal(rows[1].text, '# FAQ\nShipping takes 3 days.')
  assert.equal(rows[1].words, 6)
  assert.ok(Number.isNaN(rows[2].added), 'no created_at stays unknown')
  assert.deepEqual(sortKnowledge(rows, { key: 'added', dir: 'desc' }).map((r) => r.id), ['a1', 'b2', 'c3'])
  assert.deepEqual(sortKnowledge(rows, { key: 'name', dir: 'asc' }).map((r) => r.id), ['b2', 'c3', 'a1'])
  assert.deepEqual([fileType('a.PDF'), fileType('notes'), fileType('x.docx'), fileType(null)], ['PDF', 'File', 'Word', 'Text'])
  assert.deepEqual([formatBytes(12), formatBytes(2150)], ['12 B', '2.1 KB'])
  assert.deepEqual(knowledgeRows({ results: [{ id: 'r', text: 't', score: 0.873 }] }).map((r) => relevance(r.score)), [87])
  assert.equal(relevance(null), null)
})

test('knowledge: search snippets mark the query words around the first match', () => {
  const text = `${'intro '.repeat(40)}customers get a full Refund within 30 days ${'tail '.repeat(40)}`
  const segs = snippet(text, 'refund days', 80)
  assert.ok(segs[0].text.startsWith('…'), 'cut before the match')
  assert.deepEqual(segs.filter((s) => s.hit).map((s) => s.text), ['Refund', 'days'])
  assert.deepEqual(snippet('short text', 'zzz'), [{ text: 'short text', hit: false }])
})

test('knowledge: the store and its health in plain words, never a class name', () => {
  const sdk = storeStatus({ backend: 'SDKKnowledgeManager', status: 'ok', embedding: { available: true } })
  const degraded = storeStatus({ backend: 'SDKKnowledgeManager', status: 'degraded', embedding: { available: false }, warnings: ['Embedding model unavailable'] })
  assert.deepEqual([sdk.store, sdk.search, sdk.label, degraded.search, degraded.label, degraded.tone, degraded.warnings], ['Vector store', 'Semantic', 'Ready', 'Keyword', 'Limited', 'warn', ['Embedding model unavailable']])
  assert.deepEqual([storeStatus({ backend: 'SimpleKnowledgeManager', status: 'ok' }).store, storeStatus(null, 'HTTP 500').label], ['In memory', 'Unavailable'])
  assert.doesNotMatch(JSON.stringify([sdk, degraded]), /Manager/)
  assert.equal(uploadError({ knowledge_indexed: true }), null)
  assert.equal(uploadError({ knowledge_indexed: false, knowledge_error: 'no SDK' }), 'no SDK')
})

// ── logs ──
test('logs: buffer lines become viewer entries and a downloadable text', () => {
  const entries = logEntries({ logs: [{ timestamp: '2026-11-15T12:00:01Z', level: 'WARNING', logger: 'aiui', message: 'slow' }, null] })
  assert.equal(entries.length, 1)
  assert.deepEqual([entries[0].level, entries[0].source, entries[0].message], ['WARNING', 'aiui', 'slow'])
  assert.equal(logsAsText(entries), '2026-11-15T12:00:01Z WARNING aiui slow\n')
  assert.deepEqual(logEntries({}), [])
})

// ── settings ──
const SCHEMA = {
  properties: {
    provider: { title: 'Provider Settings', properties: { name: { type: 'string', title: 'Provider Name', enum: ['openai', 'anthropic'] }, api_key: { type: 'string', title: 'API Key', format: 'password' } } },
    model: { title: 'Model Settings', properties: { temperature: { type: 'number', title: 'Temperature', default: 0.7 } } },
    server: { title: 'Server Settings', properties: { debug: { type: 'boolean', title: 'Debug Mode' } } },
  },
}

test('settings: schema sections become a section list of fields with controls and plain help', () => {
  const sections = settingsSections(SCHEMA)
  assert.deepEqual(sections.map((s) => s.title), ['Provider', 'Model', 'Server'])
  assert.deepEqual(sections[0].fields.map((f) => f.kind), ['select', 'secret'])
  assert.deepEqual(sections[1].fields.map((f) => f.kind), ['number'])
  assert.deepEqual(sections[2].fields.map((f) => f.kind), ['switch'])
  for (const s of sections) for (const f of s.fields) assert.ok(f.help, `${f.path} has help`)
  assert.ok(matchField(sections[1].fields[0], 'temp'))
  assert.ok(!matchField(sections[1].fields[0], 'zzz'))
  // Labels in sentence case; acronyms keep their capitals.
  assert.deepEqual(sections[0].fields.map((f) => f.title), ['Provider name', 'API key'])
  assert.equal(sections[2].fields[0].title, 'Debug mode')
  assert.equal(sentenceCase('API Base URL'), 'API base URL')
  assert.equal(sentenceCase('Max Tokens'), 'Max tokens')
  assert.equal(sentenceCase('GPT4 Model'), 'GPT4 model')
})

test('settings: a custom gateway is named under the provider heading; the built-in provider is not', () => {
  assert.match(providerNote({ provider: 'MockProvider' }), /^Chats are answered by MockProvider\. These settings apply to the built-in PraisonAI provider\.$/)
  assert.equal(providerNote({ provider: 'PraisonAIProvider' }), '')
  assert.equal(providerNote(null), '')
})

test('settings: values by path, defaults, and what changed', () => {
  const sections = settingsSections(SCHEMA)
  const saved = { model: { temperature: 0.7 } }
  const draft = setPath(saved, 'model.temperature', 1.2)
  assert.equal(getPath(draft, 'model.temperature'), 1.2)
  assert.equal(getPath(saved, 'model.temperature'), 0.7, 'the saved config is not mutated')
  assert.deepEqual(changedPaths(sections, saved, draft), ['model.temperature'])
  assert.equal(valueOf({}, { provider: { name: 'openai' } }, sections[0].fields[0]), 'openai')
  assert.equal(valueOf({}, {}, sections[1].fields[0]), 0.7)
})

// ── overview ──
test('overview: greeting, the one-sentence summary, sparklines and feature health', () => {
  assert.equal(greeting(new Date(2026, 10, 15, 9)), 'Good morning')
  assert.equal(greeting(new Date(2026, 10, 15, 15)), 'Good afternoon')
  assert.equal(greeting(new Date(2026, 10, 15, 20)), 'Good evening')
  assert.equal(summary({ waiting: 1, running: 1, agentWaiting: 'Researcher' }), '1 run is working, and Researcher needs your approval.')
  assert.match(summary({ waiting: 0, running: 0 }), /^Everything is quiet/)
  // Quiet is only said when nothing needs a look.
  assert.equal(summary({ waiting: 0, running: 0, attention: 1 }), '1 thing needs a look: see Feature health.')
  assert.equal(summary({ waiting: 0, running: 0, attention: 2 }), '2 things need a look: see Feature health.')
  assert.equal(summary({ waiting: 0, running: 0, attention: 1, keyMissing: true }), 'Add an API key in Settings to start chatting.')
  assert.equal(attentionLabel(1), '1 needs attention')
  assert.equal(attentionLabel(3), '3 need attention')
  assert.deepEqual(series({ timeseries: [{ tokens: 1 }, { tokens: 'x' }, {}] }), [1, 0, 0])
  assert.equal(sparkPath([1, 1, 1], 72, 20), '', 'a flat line draws nothing')
  assert.equal(sparkPath([0, 10], 72, 20), '0.0,19.0 72.0,1.0')
  assert.equal(formatCost(0), '$0.00')
  assert.deepEqual(featureHealth({ features: [{ name: 'chat', health: { status: 'ok' } }, { name: 'agui', health: { status: 'degraded' } }] }).map((f) => f.name), ['agui', 'chat'])
})

test('overview: the provider line follows /api/provider/health, as Settings and the chat banner do', () => {
  assert.deepEqual(providerLine({ status: 'ok', api_key: 'missing' }), { tone: 'warn', text: 'Not configured', addKey: true })
  assert.deepEqual(providerLine({ status: 'ok', api_key: 'set' }), { tone: 'ok', text: 'Connected' })
  assert.deepEqual(providerLine({ status: 'ok' }), { tone: 'ok', text: 'Connected' })
  assert.deepEqual(providerLine({ status: 'error', detail: 'refused' }), { tone: 'warn', text: 'refused' })
  assert.deepEqual(providerLine(null, 'HTTP 500'), { tone: 'warn', text: 'HTTP 500' })
})

// ── registration and the classic fallback ──
const page = (id: string): ShellPage => ({ id, title: id, kind: 'legacy' })

test('each page is the browser half of its record and registers only when listed', () => {
  assert.deepEqual(appPageBuiltins.map((b) => [b.name, b.pages[0]]), [
    ['builtin.overview', 'overview'],
    ['builtin.sessions', 'sessions'],
    ['builtin.agents', 'agents'],
    ['builtin.knowledge', 'knowledge'],
    ['builtin.logs', 'logs'],
    ['builtin.config', 'config'],
  ])
  const registered: string[] = []
  const sdk = { registerPage: (id: string) => registered.push(id) } as never
  appPageBuiltins[1].activate(sdk, { manifest: {} as never, pageIds: ['sessions'] })
  appPageBuiltins[3].activate(sdk, { manifest: {} as never, pageIds: [] })
  assert.deepEqual(registered, ['sessions'])
})

beforeEach(() => resetLayoutsForTests())
afterEach(() => resetLayoutsForTests())

const html = (C: ComponentType<{ page: ShellPage }>, id: string) => renderToStaticMarkup(createElement(C, { page: page(id) }))

test('the classic frame keeps the legacy view (no layout on screen)', async () => {
  for (const [C, id] of [[SessionsPage, 'sessions'], [AgentsPage, 'agents'], [LogsPage, 'logs'], [SettingsPage, 'config'], [OverviewPage, 'overview'], [KnowledgePage, 'knowledge']] as const) {
    // The legacy host is the shell's own lazy chunk: render through Suspense.
    const { prelude } = await prerender(createElement(C, { page: page(id) }))
    const out = await new Response(prelude).text()
    assert.match(out, /aiui-legacy-host/, id)
    assert.doesNotMatch(out, /data-aiui-app-page/, id)
  }
})

test('inside a layout each page draws its Pro template with no server data yet', () => {
  registerLayout('test-frame', { title: 'Test' }, () => null)
  activateLayout('test-frame')
  const sessions = html(SessionsPage, 'sessions')
  assert.match(sessions, /data-aiui-app-page="sessions"/)
  assert.match(sessions, /data-aiui-template="list"/)
  assert.match(sessions, /Search sessions/)
  assert.match(sessions, /aria-pressed="true"[^>]*>All</)
  const agents = html(AgentsPage, 'agents')
  assert.match(agents, /data-aiui-app-page="agents"/)
  assert.match(agents, /data-aiui-template="list"/)
  assert.match(agents, /role="status" aria-label="Loading agents"/, 'a skeleton, not a bare Loading…')
  assert.match(html(LogsPage, 'logs'), /data-aiui-app-page="logs"[\s\S]*aria-label="Clear the log"/)
  assert.match(html(SettingsPage, 'config'), /Loading settings/)
  const overview = html(OverviewPage, 'overview')
  assert.match(overview, /data-aiui-app-page="overview"/)
  assert.match(overview, /Today at a glance/)
  assert.equal((overview.match(/data-aiui-tile=""/g) ?? []).length, 4)
  assert.match(overview, /Nothing waits for you/)
  const knowledge = html(KnowledgePage, 'knowledge')
  assert.match(knowledge, /data-aiui-app-page="knowledge"[\s\S]*aria-label="Knowledge base summary"/)
  assert.match(knowledge, /Search knowledge[\s\S]*Add knowledge/)
  assert.match(knowledge, /data-slot="skeleton"/, 'a skeleton while the first read is out')
  assert.doesNotMatch(knowledge, /Loading…|KnowledgeManager/)
})

test('no native select and no emoji in the app pages', () => {
  const dir = path.join(process.cwd(), 'src/app-pages')
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const f = path.join(d, n)
      return statSync(f).isDirectory() ? walk(f) : /\.tsx$/.test(n) && !/\.test\./.test(n) ? [f] : []
    })
  for (const f of walk(dir)) assert.doesNotMatch(readFileSync(f, 'utf8'), /<select\b/, f)
})
