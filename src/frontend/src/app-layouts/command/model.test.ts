// The Command Deck's frame model: rail G keys, the G sequence, session tabs,
// today's usage, the status line, the shortcut sheet; and the frame's data
// helpers (open gates, merged pending approvals).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LayoutNavItem } from '@/sdk/layouts'
import type { ChatMessageView } from '@/sdk/layoutTypes'
import { chatGates, latestAgent, mergePending } from './data'
import { activityText, createGoSequence, GO_TIMEOUT_MS, MAX_TABS, railItems, sessionTabs, shortcutRows, shortSessionId, todayUsage } from './model'

const item = (id: string, title = id[0].toUpperCase() + id.slice(1)): LayoutNavItem => ({ id, title, group: 'Main', href: `/${id}`, active: false })

test('rail: the design’s G letters, then a free letter of the title, at most seven items', () => {
  const rail = railItems([item('chat'), item('runs'), item('agents'), item('jobs'), item('config'), item('cron', 'Schedules'), item('memory'), item('extra')])
  assert.equal(rail.length, 7)
  assert.deepEqual(rail.map((r) => `${r.id}:${r.go}`), ['chat:c', 'runs:r', 'agents:a', 'jobs:j', 'config:s', 'cron:o', 'memory:m'])
  const clash = railItems([item('alpha', 'Agents two'), item('agents')])
  assert.deepEqual(clash.map((r) => r.go), ['g', 'a'], 'a taken letter moves on to the next free one')
})

test('G sequence: g then a letter within the timeout; anything else passes through', () => {
  let now = 1000
  const seq = createGoSequence(() => railItems([item('chat'), item('runs')]), () => now)
  assert.deepEqual(seq.press('x'), { handled: false })
  assert.deepEqual(seq.press('g'), { handled: true })
  assert.equal(seq.armed, true)
  assert.equal(seq.press('r').item?.id, 'runs')
  assert.equal(seq.armed, false)
  seq.press('g')
  now += GO_TIMEOUT_MS + 1
  assert.deepEqual(seq.press('r'), { handled: false }, 'too late: r is just r')
  seq.press('g')
  assert.deepEqual(seq.press('z'), { handled: false, item: undefined }, 'no page on z: the key is not taken')
})

test('session tabs: newest first, nine at most, the open session always among them', () => {
  const sessions = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, title: `Chat ${i}` }))
  const tabs = sessionTabs(sessions, 's1', new Set(['s2']), new Set(['s1']))
  assert.equal(tabs.length, MAX_TABS)
  assert.deepEqual(tabs.slice(0, 3).map((t) => [t.id, t.key, t.active, t.running, t.waiting]), [
    ['s0', 1, false, false, false],
    ['s1', 2, true, false, true],
    ['s2', 3, false, true, false],
  ])
  const old = sessionTabs(sessions, 's11', new Set())
  assert.equal(old[8].id, 's11', 'an older open session takes the last tab')
  assert.equal(old[8].active, true)
  const fresh = sessionTabs(sessions.slice(0, 2), null, new Set())
  assert.deepEqual(fresh.map((t) => [t.id, t.title, t.active]), [[null, 'New chat', true], ['s0', 'Chat 0', false], ['s1', 'Chat 1', false]])
  assert.deepEqual(sessionTabs([], 'gone', new Set()).map((t) => t.title), ['Chat'], 'a session the list does not have yet')
  assert.equal(shortSessionId('ses_8f2a91'), 'ses_8f2a91')
  assert.equal(shortSessionId('0d6f3c4e-1234-4abc-9def-001122334455'), '0d6f3c4e-1')
})

test('today’s usage counts runs since local midnight', () => {
  const now = new Date(2026, 10, 15, 14, 0).getTime()
  const midnight = new Date(2026, 10, 15).getTime()
  const u = todayUsage(
    [
      { startedAt: now - 1000, tokens: 1000, cost: 0.0003 },
      { startedAt: midnight + 1, tokens: 432, cost: 0.00015 },
      { startedAt: midnight - 1, tokens: 99999, cost: 9 },
      { startedAt: now - 5 },
    ],
    now,
  )
  assert.deepEqual(u, { runs: 3, tokens: 1432, cost: 0.00045 })
  assert.equal(activityText(1, 1), '1 run active · 1 approval')
  assert.equal(activityText(0, 0), '0 runs active')
  assert.equal(activityText(2, 3), '2 runs active · 3 approvals')
})

test('the shortcut sheet lists the frame, the G keys and the run panel keys', () => {
  const rows = shortcutRows(railItems([item('chat'), item('runs')]), true)
  assert.deepEqual(rows.map((s) => s.title), ['Anywhere', 'Go to', 'Run panel'])
  assert.deepEqual(rows[1].rows, [{ keys: ['G', 'C'], label: 'Chat' }, { keys: ['G', 'R'], label: 'Runs' }])
  assert.ok(rows[0].rows.some((r) => r.keys.join('') === '⌘I'))
  assert.ok(shortcutRows([], false)[0].rows.some((r) => r.keys.join(' ') === 'Ctrl K'))
})

test('pending approvals: the open chat’s gates join the feed’s, without doubles', () => {
  const messages: ChatMessageView[] = [
    {
      id: 'a', role: 'assistant', createdAt: 1, agentName: 'Researcher',
      parts: [
        { type: 'tool-call', id: 't1', toolName: 'shell', args: { cmd: 'ls' }, artifact: { risk_level: 'high' }, approval: { id: 'ap_1' } },
        { type: 'tool-call', id: 't2', toolName: 'shell', args: {}, artifact: {}, approval: { id: 'ap_0', approved: true } },
      ],
    },
    { id: 'b', role: 'assistant', createdAt: 2, status: { type: 'incomplete', reason: 'cancelled' }, parts: [{ type: 'tool-call', id: 't3', toolName: 'x', args: {}, artifact: {}, approval: { id: 'dead' } }] },
  ]
  const gates = chatGates(messages, 's1')
  assert.deepEqual(gates, [{ id: 'ap_1', toolName: 'shell', agentName: 'Researcher', sessionId: 's1', riskLevel: 'high', description: undefined, args: { cmd: 'ls' } }])
  assert.deepEqual(mergePending([{ id: 'ap_1' }, { id: 'ap_9' }], gates).map((a) => a.id), ['ap_1', 'ap_9'])
  assert.deepEqual(mergePending([], gates).map((a) => a.id), ['ap_1'])
  assert.equal(latestAgent(messages), 'Researcher')
})
