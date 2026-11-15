// Mission board KPI and time formats (format.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatAgo, formatClock, formatCost, formatCount, formatDelta, formatDuration, formatPercent, formatTime, formatTokens, metaLine } from './format'

test('counts and deltas', () => {
  assert.equal(formatCount(3412), '3,412')
  assert.equal(formatCount(42), '42')
  assert.equal(formatCount(undefined), '—')
  assert.equal(formatCount(Number.NaN), '—')
  assert.equal(formatDelta(6), '+6')
  assert.equal(formatDelta(-2), '−2')
  assert.equal(formatDelta(0), '±0')
  assert.equal(formatDelta(undefined), '')
})

test('success rate as a percentage, one decimal only when it says something', () => {
  assert.equal(formatPercent(0.976), '97.6%')
  assert.equal(formatPercent(41 / 42), '97.6%')
  assert.equal(formatPercent(1), '100%')
  assert.equal(formatPercent(0), '0%')
  assert.equal(formatPercent(1.4), '100%')
  assert.equal(formatPercent(undefined), '—')
})

test('cost: cents, then mills under a cent, never a negative', () => {
  assert.equal(formatCost(1.84), '$1.84')
  assert.equal(formatCost(10), '$10.00')
  assert.equal(formatCost(0.012), '$0.012')
  assert.equal(formatCost(0.0123), '$0.012')
  assert.equal(formatCost(0.07), '$0.07')
  assert.equal(formatCost(0.004), '$0.004')
  assert.equal(formatCost(0.41), '$0.41')
  assert.equal(formatCost(0.0004), '<$0.001')
  assert.equal(formatCost(0), '$0.00')
  assert.equal(formatCost(-3), '$0.00')
  assert.equal(formatCost(1240.5), '$1,241')
  assert.equal(formatCost(undefined), '—')
})

test('durations and latency like the design (2.1s, p95 6.8s, 0.3s)', () => {
  assert.equal(formatDuration(2100), '2.1s')
  assert.equal(formatDuration(6849), '6.8s')
  assert.equal(formatDuration(300), '0.3s')
  assert.equal(formatDuration(2000), '2.0s')
  assert.equal(formatDuration(40), '<0.1s')
  assert.equal(formatDuration(65_000), '1m 05s')
  assert.equal(formatDuration(3_720_000), '1h 02m')
  assert.equal(formatDuration(-1), '—')
  assert.equal(formatDuration(undefined), '—')
})

test('waiting timers and relative times', () => {
  assert.equal(formatClock(42_000), '0:42')
  assert.equal(formatClock(61_500), '1:01')
  assert.equal(formatClock(-5), '0:00')
  assert.equal(formatClock(4_500_000), '1:15:00')
  const now = 10_000_000
  assert.equal(formatAgo(now - 20_000, now), 'just now')
  assert.equal(formatAgo(now - 38 * 60_000, now), '38m ago')
  assert.equal(formatAgo(now - 3 * 3_600_000, now), '3h ago')
  assert.equal(formatAgo(now - 2 * 86_400_000, now), '2d ago')
  assert.equal(formatAgo(now + 5000, now), 'just now')
})

test('wall-clock time, tokens and meta lines', () => {
  const at = new Date(2026, 10, 15, 14, 2, 9).getTime()
  assert.equal(formatTime(at), '14:02:09')
  assert.equal(formatTokens(3412), '3,412 tok')
  assert.equal(formatTokens(undefined), '')
  assert.equal(metaLine('gpt-4o-mini', '', undefined, '3,412 tok', false, '$0.012'), 'gpt-4o-mini · 3,412 tok · $0.012')
})
