// The app shell's React pages (src/app-pages): their pure data models, the
// classic-frame fallback, their registration as built-ins, and what each
// page draws with no server data (SSR, layout on).
import { afterEach, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { activateLayout, registerLayout, resetLayoutsForTests } from '@/sdk/layouts'
import type { ShellPage } from '@/sdk/manifest'
import { appPageBuiltins } from '@/builtin/appPages'
import { ago, toMs } from './shared'
import { filterRows, sessionRows, sortRows } from './sessions/model'
import { logEntries, logsAsText } from './logs/model'
import { changedPaths, getPath, matchField, setPath, settingsSections, valueOf } from './settings/model'
import { featureHealth, formatCost, greeting, series, sparkPath, summary } from './overview/model'
import SessionsPage from './sessions/SessionsPage'
import LogsPage from './logs/LogsPage'
import SettingsPage from './settings/SettingsPage'
import OverviewPage from './overview/OverviewPage'

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
  assert.deepEqual(series({ timeseries: [{ tokens: 1 }, { tokens: 'x' }, {}] }), [1, 0, 0])
  assert.equal(sparkPath([1, 1, 1], 72, 20), '', 'a flat line draws nothing')
  assert.equal(sparkPath([0, 10], 72, 20), '0.0,19.0 72.0,1.0')
  assert.equal(formatCost(0), '$0.00')
  assert.deepEqual(featureHealth({ features: [{ name: 'chat', health: { status: 'ok' } }, { name: 'agui', health: { status: 'degraded' } }] }).map((f) => f.name), ['agui', 'chat'])
})

// ── registration and the classic fallback ──
const page = (id: string): ShellPage => ({ id, title: id, kind: 'legacy' })

test('each page is the browser half of its record and registers only when listed', () => {
  assert.deepEqual(appPageBuiltins.map((b) => [b.name, b.pages[0]]), [
    ['builtin.overview', 'overview'],
    ['builtin.sessions', 'sessions'],
    ['builtin.logs', 'logs'],
    ['builtin.config', 'config'],
  ])
  const registered: string[] = []
  const sdk = { registerPage: (id: string) => registered.push(id) } as never
  appPageBuiltins[1].activate(sdk, { manifest: {} as never, pageIds: ['sessions'] })
  appPageBuiltins[2].activate(sdk, { manifest: {} as never, pageIds: [] })
  assert.deepEqual(registered, ['sessions'])
})

beforeEach(() => resetLayoutsForTests())
afterEach(() => resetLayoutsForTests())

const html = (C: ComponentType<{ page: ShellPage }>, id: string) => renderToStaticMarkup(createElement(C, { page: page(id) }))

test('the classic frame keeps the legacy view (no layout on screen)', () => {
  for (const [C, id] of [[SessionsPage, 'sessions'], [LogsPage, 'logs'], [SettingsPage, 'config'], [OverviewPage, 'overview']] as const) {
    const out = html(C, id)
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
  assert.match(html(LogsPage, 'logs'), /data-aiui-app-page="logs"[\s\S]*aria-label="Clear the log"/)
  assert.match(html(SettingsPage, 'config'), /Loading settings/)
  const overview = html(OverviewPage, 'overview')
  assert.match(overview, /data-aiui-app-page="overview"/)
  assert.match(overview, /Today at a glance/)
  assert.equal((overview.match(/data-aiui-tile=""/g) ?? []).length, 4)
  assert.match(overview, /Nothing waits for you/)
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
