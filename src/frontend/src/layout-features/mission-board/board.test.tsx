// The mission board's views in markup: the approval banner, the KPI strip
// (data, loading, ledger off), the agent card, the run timeline region and
// the ops column / overview with their feeds off.
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { provideLayoutData, resetLayoutsForTests } from '@/sdk/layouts'
import type { AgentStatus, ApprovalItem, ApprovalsFeed, ChatFeed, ChatState, Feed, RunKpis, RunsFeed, RunSummary } from '@/sdk/layoutTypes'
import AttentionBanner, { ApprovalBanner } from './ApprovalBanner'
import OpsColumn from './OpsColumn'
import OpsOverview from './OpsOverview'
import RunTimeline from './RunTimeline'
import { AgentCard, KpiStrip } from './widgets'

const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el)

beforeEach(() => resetLayoutsForTests())

const still = <T,>(v: T): Feed<T> => ({ get: () => v, subscribe: () => () => {} })

function approvals(pending: ApprovalItem[]): ApprovalsFeed {
  return { ...still({ pending }), approve: async () => {}, deny: async () => {} }
}

function runs(kpis: RunKpis | null, agents: AgentStatus[], recent: RunSummary[] = []): RunsFeed {
  return { kpis: () => still(kpis), agents: () => still(agents), recent: () => still(recent), run: () => still(null) }
}

const pip: ApprovalItem = { id: 'ap_1', agentName: 'Coder', toolName: 'shell', args: { cmd: 'pip install numpy' }, riskLevel: 'high' }
const kpis: RunKpis = { window: 'today', runs: 42, runsDelta: 6, successRate: 41 / 42, cost: 1.84, budget: 10, p50Ms: 2100, p95Ms: 6800 }

test('approval banner: who asks, the call, Review / Deny / Approve', () => {
  const decide = async () => {}
  const out = html(createElement(ApprovalBanner, { item: pip, more: 2, decide, onReview: () => {} }))
  assert.match(out, /role="alert" data-aiui-approval-banner="ap_1"/)
  assert.match(out, /Coder needs your approval to continue/)
  assert.match(out, /<code[^>]*>pip install numpy<\/code> · high risk · 2 more waiting/)
  assert.deepEqual([...out.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]), ['Review', 'Deny', 'Approve'])
  const phone = html(createElement(ApprovalBanner, { item: pip, more: 0, decide, touch: true, onReview: () => {} }))
  assert.doesNotMatch(phone, />Review</, 'the phone has the approvals tab instead')
  assert.equal((phone.match(/h-11 flex-1/g) ?? []).length, 2, '44 px decision buttons')
})

test('KPI strip: four cells like the design; a skeleton while loading; a note when the ledger is off', () => {
  const out = html(createElement(KpiStrip, { kpis, status: 'ok' }))
  assert.match(out, /role="list" aria-label="Today"/)
  assert.equal((out.match(/role="listitem"/g) ?? []).length, 4)
  for (const s of ['Runs today', '>42<', '\\+6', '97.6%', '\\$1.84', 'of \\$10.00', '2.1s', 'p95 6.8s']) assert.match(out, new RegExp(s))
  assert.match(html(createElement(KpiStrip, { kpis, status: 'ok', size: 'touch' })), />p50</)
  assert.match(html(createElement(KpiStrip, { kpis: null, status: 'loading' })), /data-slot="skeleton"/)
  assert.match(html(createElement(KpiStrip, { kpis: null, status: 'off' })), /data-aiui-kpis="off"[^>]*>Run history is off/)
})

test('agent card: state chip, timer, activity and meta; a waiting card is a warning', () => {
  const now = 100_000
  const waiting = html(createElement(AgentCard, { agent: { name: 'Coder', state: 'waiting', model: 'gpt-4o', costToday: 0.07, approval: { ...pip, createdAt: now - 42_000 } }, now, onSelect: () => {} }))
  assert.match(waiting, /data-aiui-agent="Coder"/)
  assert.match(waiting, /data-aiui-agent-state="waiting"[^>]*>.*Waiting for approval/)
  assert.match(waiting, />0:42</)
  assert.match(waiting, /Wants to run <code[^>]*>pip install numpy/)
  assert.match(waiting, /gpt-4o · \$0.07/)
  assert.match(waiting, /bg-warning-soft/)
  const phone = html(createElement(AgentCard, { agent: { name: 'Researcher', state: 'running', elapsedMs: 7000 }, now, size: 'touch', action: 'Open chat', onSelect: () => {} }))
  assert.match(phone, /Open chat/)
  assert.match(phone, /min-h-11/)
})

test('run timeline region: one segment per step, nothing for a turn without steps', () => {
  const T0 = Date.now() - 10_000
  const state: ChatState = {
    sessionId: 's1',
    isRunning: false,
    messages: [
      {
        id: 'm1',
        role: 'assistant',
        createdAt: T0,
        completedAt: T0 + 6400,
        status: { type: 'complete' },
        parts: [
          { type: 'reasoning', id: 'r', text: '', done: true, timing: { startedAt: T0, completedAt: T0 + 2000 } },
          { type: 'tool-call', id: 't', toolName: 'terminal', args: {}, result: 'ok', artifact: {}, timing: { startedAt: T0 + 2000, completedAt: T0 + 2300 } },
          { type: 'text', id: 'x', text: 'answer' },
        ],
      },
      { id: 'm2', role: 'assistant', createdAt: T0, parts: [], status: { type: 'complete' } },
    ],
  }
  const chat: ChatFeed = { ...still(state), prefill: () => {}, cancel: async () => {}, resolveApproval: async () => {} }
  provideLayoutData('chat', chat)
  const region = { sessionId: 's1', viewport: 'desktop' as const, reportBadge: () => {} }
  const out = html(createElement(RunTimeline, { ...region, messageId: 'm1' }))
  assert.match(out, /<ol aria-label="Run timeline"/)
  assert.deepEqual([...out.matchAll(/data-step-kind="([^"]+)"/g)].map((m) => m[1]), ['think', 'tool', 'answer'])
  assert.match(out, /Think<\/span><span[^>]*>2.0s/)
  assert.match(out, /terminal<\/span><span[^>]*>0.3s/)
  assert.match(out, /Answer<\/span><span[^>]*>4.1s/)
  assert.equal(html(createElement(RunTimeline, { ...region, messageId: 'm2' })), '')
  assert.equal(html(createElement(RunTimeline, { ...region, messageId: 'missing' })), '')
})

test('ops column: KPIs, agents waiting first, New chat (with the feeds a server gives)', () => {
  provideLayoutData('runs', runs(kpis, [{ name: 'Researcher', state: 'running' }, { name: 'Coder', state: 'running' }]))
  provideLayoutData('approvals', approvals([pip]))
  const out = html(createElement(OpsColumn, { openChat: () => {} }))
  assert.match(out, /aria-label="Operations" data-aiui-ops-column/)
  assert.deepEqual([...out.matchAll(/data-aiui-agent="([^"]+)"/g)].map((m) => m[1]), ['Coder', 'Researcher'])
  assert.match(out, /1 running · 1 waiting/)
})

test('ops column and overview never crash with every feed off', () => {
  // No provider at all: the board's own run feed (not polled in a static render) and no approvals.
  assert.match(html(createElement(OpsColumn, { openChat: () => {} })), /data-aiui-ops-column/)
  const out = html(createElement(OpsOverview, { viewport: 'desktop', openChat: () => {} }))
  assert.match(out, /data-aiui-ops-overview/)
  assert.doesNotMatch(out, /data-aiui-ops-approvals/)
})

test('ops overview: approvals first on a phone, then KPIs and agents; recent runs on desktop', () => {
  provideLayoutData('runs', runs(kpis, [{ name: 'Writer', state: 'idle', lastRunAt: Date.now() - 60_000 }], [
    { id: 'r1', agent: 'Writer', startedAt: Date.now() - 5000, endedAt: Date.now() - 2000, status: 'completed', stepCount: 4, tokens: 900, cost: 0.004 },
  ]))
  provideLayoutData('approvals', approvals([pip]))
  const phone = html(createElement(OpsOverview, { viewport: 'phone', openChat: () => {} }))
  const order = ['data-aiui-ops-approvals', 'data-aiui-kpis', 'Tap an agent to open its chat'].map((s) => phone.indexOf(s))
  assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], `phone order ${order}`)
  assert.doesNotMatch(phone, /data-aiui-recent-runs/)
  assert.match(phone, /data-aiui-approval="ap_1"[\s\S]*Needs approval[\s\S]*Coder wants to run a command[\s\S]*\$ pip install numpy/)
  assert.equal((phone.match(/h-11 flex-1/g) ?? []).length, 2, '44 px decision buttons')
  const desk = html(createElement(OpsOverview, { viewport: 'desktop', openChat: () => {}, environment: 'prod' }))
  assert.match(desk, /Today · prod/)
  assert.match(desk, /data-aiui-run="r1"/)
  assert.match(desk, /Succeeded/)
  assert.match(desk, /\$0.004/)
})

function chatWithGate(): ChatFeed {
  const state: ChatState = {
    sessionId: 's1',
    isRunning: true,
    messages: [
      {
        id: 'm1',
        role: 'assistant',
        agentName: 'Mock',
        createdAt: 5,
        status: { type: 'requires-action', reason: 'interrupt' },
        parts: [{ type: 'tool-call', id: 'tc', toolName: 'shell', args: { cmd: 'ls' }, artifact: { risk_level: 'high' }, approval: { id: 'ap_ok' } }],
      },
    ],
  }
  return { ...still(state), prefill: () => {}, cancel: async () => {}, resolveApproval: async () => {} }
}

test('attention banner: a listed approval first; a gate of the open chat off the chat page; nothing else', () => {
  const where = { approvalsPage: 'approvals', chatPage: 'chat', go: () => {}, canReview: true }
  assert.equal(html(createElement(AttentionBanner, { ...where, pageId: 'logs' })), '', 'no feeds: no banner')
  provideLayoutData('chat', chatWithGate())
  const gate = html(createElement(AttentionBanner, { ...where, pageId: 'logs' }))
  assert.match(gate, /data-aiui-approval-banner="ap_ok"/)
  assert.match(gate, /Mock needs your approval/)
  assert.match(gate, />Open chat</)
  assert.equal(html(createElement(AttentionBanner, { ...where, pageId: 'chat' })), '', 'the thread shows its own gate')
  provideLayoutData('approvals', approvals([pip]))
  const listed = html(createElement(AttentionBanner, { ...where, pageId: 'chat' }))
  assert.match(listed, /data-aiui-approval-banner="ap_1"/)
  assert.match(listed, />Review</)
  assert.match(html(createElement(AttentionBanner, { ...where, pageId: 'logs' })), /data-aiui-approval-banner="ap_1"[\s\S]*1 more waiting/)
  assert.match(html(createElement(AttentionBanner, { ...where, pageId: 'approvals' })), /data-aiui-approval-banner="ap_ok"/)
})
