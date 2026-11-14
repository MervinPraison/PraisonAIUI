// npm test -- chat-engine/util
// Exfiltration and link guards for agent-provided element / reference URLs.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { connectionLabel, formatDuration, hostOf, isLastReply, isTrustedImageUrl, safeUrl } from './util'

const g = globalThis as { location?: unknown }
let prev: unknown
before(() => {
  prev = g.location
  g.location = { origin: 'https://app.test', href: 'https://app.test/chat' }
})
after(() => {
  g.location = prev
})

test('images auto-load only from same-origin, data:image/ and blob:', () => {
  assert.equal(isTrustedImageUrl('/icon.svg'), true)
  assert.equal(isTrustedImageUrl('https://app.test/files/a.png'), true)
  assert.equal(isTrustedImageUrl('data:image/png;base64,AAAA'), true)
  assert.equal(isTrustedImageUrl('blob:https://app.test/123'), true)
  // a prompt-injected element must not beacon data out just by rendering
  assert.equal(isTrustedImageUrl('https://evil.test/?q=secret'), false)
  assert.equal(isTrustedImageUrl('//evil.test/x.png'), false)
  assert.equal(isTrustedImageUrl('http://app.test/x.png'), false, 'scheme change is another origin')
  assert.equal(isTrustedImageUrl('javascript:alert(1)'), false)
  assert.equal(hostOf('https://evil.test/x.png'), 'evil.test')
})

test('safeUrl keeps http(s), relative, blob: and data:image/, and drops script-capable schemes', () => {
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a')
  assert.equal(safeUrl('/files/a.pdf'), '/files/a.pdf')
  assert.equal(safeUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA')
  assert.equal(safeUrl('blob:https://app.test/1'), 'blob:https://app.test/1')
  assert.equal(safeUrl('javascript:alert(1)'), undefined)
  assert.equal(safeUrl(' JavaScript:alert(1)'), undefined)
  assert.equal(safeUrl('data:text/html,<script>alert(1)</script>'), undefined)
  assert.equal(safeUrl('vbscript:x'), undefined)
  assert.equal(safeUrl(''), undefined)
  assert.equal(safeUrl(42), undefined)
})

test('formatDuration', () => {
  assert.equal(formatDuration(250), '0.3s')
  assert.equal(formatDuration(4200), '4.2s')
  assert.equal(formatDuration(42_000), '42s')
  assert.equal(formatDuration(125_000), '2m 5s')
  assert.equal(formatDuration(-1), '')
})

test('regenerate targets only the last answer (an earlier answer is never turned into a regenerate of the last)', () => {
  const thread = [
    { id: 'u1', role: 'user' }, { id: 'a1', role: 'assistant' },
    { id: 'u2', role: 'user' }, { id: 'a2', role: 'assistant' },
  ]
  assert.equal(isLastReply(thread, 'u2'), true)
  assert.equal(isLastReply(thread, 'u1'), false, 'the first answer')
  assert.equal(isLastReply(thread, null), false)
  assert.equal(isLastReply([], 'u1'), false)
  assert.equal(isLastReply([{ id: 'u1', role: 'user' }, { id: 'u2', role: 'user' }], 'u1'), false, 'no answer to regenerate')
})

test('a closed socket with the HTTP fallback reads "Using HTTP", not a red "Offline" (G7)', () => {
  assert.deepEqual(connectionLabel('closed', { kind: 'ws', httpFallback: true }), { label: 'Using HTTP', short: 'HTTP', tone: 'pending' })
  assert.equal(connectionLabel('closed', { kind: 'sse' }).label, 'Using HTTP')
  assert.deepEqual(connectionLabel('closed', { kind: 'ws' }), { label: 'Offline', short: 'Offline', tone: 'down' })
  assert.equal(connectionLabel('open', { kind: 'ws', httpFallback: true }).tone, 'ok')
})
