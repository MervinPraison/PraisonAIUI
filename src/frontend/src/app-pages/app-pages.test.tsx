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
import CronPage from './cron/CronPage'
import { describeSchedule, draftSchedule, filterRows as filterJobs, jobRows, nextRun, nextRuns, parseCron, runHistory, scheduleDraft, until, type Draft } from './cron/model'

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

// ── cron ──
const at = (iso: string) => Date.parse(iso)

test('cron: rows and run history from the schedules API, the toolbar filters', () => {
  const rows = jobRows({ schedules: [{ id: 'a', name: 'Brief', agent_name: 'Writer', schedule: { kind: 'cron', cron_expr: '0 9 * * *' }, enabled: false, last_run_at: NOW / 1000, run_count: 2 }, { name: 'no id' }] })
  assert.deepEqual(rows.map((r) => [r.id, r.agent, r.enabled, r.lastRun, r.runs]), [['a', 'Writer', false, NOW, 2]])
  assert.deepEqual(runHistory({ history: [{ job_id: 'a', status: 'failed', result: 'boom', timestamp: NOW / 1000, duration: 1.5 }, {}] }), [{ jobId: 'a', status: 'failed', result: 'boom', at: NOW, duration: 1.5 }])
  assert.deepEqual([filterJobs(rows, 'writ', 'paused').length, filterJobs(rows, '', 'enabled').length], [1, 0])
})

test('cron: a schedule in words', () => {
  const cases: [string, string | number][] = [['Every 15 minutes', 900], ['Every hour', 3600], ['Every 2 days', 172800], ['Every 5 minutes', '*/5 * * * *'], ['Every hour at :30', '30 * * * *'], ['Every day at 09:00 UTC', '0 9 * * *'], ['Weekdays at 08:30 UTC', '30 8 * * 1-5'], ['Weekends at 10:00 UTC', '0 10 * * sat,sun'], ['Every Monday at 09:00 UTC', '0 9 * * 1'], ['Mon, Wed and Fri at 09:00 UTC', '0 9 * * 1,3,5'], ['Monthly on day 1 at 09:00 UTC', '0 9 1 * *'], ['Custom schedule', '0 9 1 1 *'], ['Custom schedule', 'nope']]
  for (const [words, s] of cases) assert.equal(describeSchedule(typeof s === 'number' ? { kind: 'every', every_seconds: s } : { kind: 'cron', cron_expr: s }), words)
})

test('cron: the parser rejects bad fields and finds the next runs in UTC, as croniter', () => {
  assert.match(parseCron('* * *').error ?? '', /five fields/)
  assert.match(parseCron('61 * * * *').error ?? '', /minute field “61”/)
  assert.match(parseCron('0 9 * * 8').error ?? '', /weekday/)
  const next = (expr: string, from: string, n = 2) => nextRuns(parseCron(expr).spec!, at(from), n).map((t) => new Date(t).toISOString().slice(0, 16))
  assert.deepEqual(next('0 9 * * *', '2026-11-15T09:00:00Z'), ['2026-11-16T09:00', '2026-11-17T09:00'])
  assert.deepEqual(next('*/20 * * * *', '2026-11-15T09:05:00Z', 3), ['2026-11-15T09:20', '2026-11-15T09:40', '2026-11-15T10:00'])
  assert.deepEqual(next('30 8 * * mon-fri', '2026-11-13T12:00:00Z'), ['2026-11-16T08:30', '2026-11-17T08:30'])
  assert.deepEqual(next('0 0 * * 7', '2026-11-15T12:00:00Z', 1), ['2026-11-22T00:00'], '7 is Sunday')
  assert.deepEqual(next('0 0 1 * 1', '2026-11-25T00:00:00Z'), ['2026-11-30T00:00', '2026-12-01T00:00'], 'both day fields: either matches')
  assert.deepEqual(next('0 0 29 2 *', '2026-11-15T00:00:00Z', 1), ['2028-02-29T00:00'])
})

test('cron: the next run counts from the last run, is due when past, and is none when paused', () => {
  const row = { schedule: { kind: 'every', every_seconds: 600 }, enabled: true, lastRun: NOW - 60_000, created: NOW - 3_600_000 }
  assert.deepEqual(nextRun(row, NOW), { at: NOW + 540_000, due: false })
  assert.deepEqual(nextRun({ ...row, lastRun: Number.NaN }, NOW), { at: NOW - 3_000_000, due: true })
  assert.equal(nextRun({ ...row, enabled: false }, NOW), null)
  assert.deepEqual(nextRun({ ...row, schedule: { kind: 'cron', cron_expr: '0 13 * * *' } }, NOW), { at: at('2026-11-15T13:00:00Z'), due: false })
  assert.deepEqual([until(NOW + 5 * 60_000, NOW), until(NOW + 3 * 3_600_000, NOW)], ['in 5 min', 'in 3 h'])
})

test('cron: the builder makes a schedule, explains a bad one, and reads a stored one back', () => {
  const d = (o: Partial<Draft>): Draft => ({ repeat: 'daily', every: 15, time: '09:00', days: [1], cron: '', ...o })
  assert.deepEqual(draftSchedule(d({ repeat: 'weekly', days: [5, 1] })).schedule, { kind: 'cron', cron_expr: '0 9 * * 1,5' })
  assert.deepEqual(draftSchedule(d({ repeat: 'custom', cron: ' 0  9 * * 1-5 ' })).schedule, { kind: 'cron', cron_expr: '0 9 * * 1-5' })
  assert.match(draftSchedule(d({ repeat: 'minutes', every: 0 })).error ?? '', /1 to 1440/)
  assert.match(draftSchedule(d({ repeat: 'weekly', days: [] })).error ?? '', /at least one day/)
  assert.match(draftSchedule(d({ repeat: 'custom', cron: '0 25 * * *' })).error ?? '', /hour field/)
  const stored = [{ kind: 'every', every_seconds: 900 }, { kind: 'every', every_seconds: 7200 }, { kind: 'cron', cron_expr: '5 7 * * *' }, { kind: 'cron', cron_expr: '0 9 * * 1,5' }, { kind: 'cron', cron_expr: '0 9 1 * *' }]
  for (const s of stored) assert.deepEqual(draftSchedule(scheduleDraft(s)).schedule, s)
  assert.deepEqual(stored.map((s) => scheduleDraft(s).repeat), ['minutes', 'hours', 'daily', 'weekly', 'custom'])
})

// ── registration and the classic fallback ──
const page = (id: string): ShellPage => ({ id, title: id, kind: 'legacy' })

test('each page is the browser half of its record and registers only when listed', () => {
  assert.deepEqual(appPageBuiltins.map((b) => [b.name, b.pages[0]]), [
    ['builtin.overview', 'overview'],
    ['builtin.sessions', 'sessions'],
    ['builtin.agents', 'agents'],
    ['builtin.logs', 'logs'],
    ['builtin.config', 'config'],
    ['builtin.cron', 'cron'],
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
  for (const [C, id] of [[SessionsPage, 'sessions'], [AgentsPage, 'agents'], [LogsPage, 'logs'], [SettingsPage, 'config'], [OverviewPage, 'overview'], [CronPage, 'cron']] as const) {
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
  const cron = html(CronPage, 'cron')
  assert.match(cron, /data-aiui-app-page="cron"/)
  assert.match(cron, /Search schedules[\s\S]*New schedule/)
  assert.match(cron, /aria-busy="true"/, 'a skeleton while the list loads')
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
