// npm test -- chat-engine/presentation
// Text of the explained approval card and the A/D keys of the keyboard strip.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commandLabel, commandOf, gateTitle, isShellCommand, whyAsked } from './gateText'
import { handleGateKey, holdKeys, ignoreKey, keyDecision } from './keys'

test('commandOf: the command-like argument first, else compact JSON, clipped to one line', () => {
  assert.equal(commandOf({ command: 'pip install numpy' }), 'pip install numpy')
  assert.equal(commandOf({ cmd: ['ls', '-la'] }), 'ls -la')
  assert.equal(commandOf({ url: 'https://example.com', timeout: 3 }), 'https://example.com')
  assert.equal(commandOf({ a: 1 }), '{"a":1}')
  assert.equal(commandOf({}), '')
  assert.equal(commandOf(undefined), '')
  assert.equal(commandOf({ code: 'print(1)\n\n  print(2)' }), 'print(1) print(2)')
  const long = commandOf({ command: 'x'.repeat(500) })
  assert.equal(long.length, 160)
  assert.ok(long.endsWith('…'))
})

test('commandLabel names what the chip shows', () => {
  assert.equal(commandLabel({ command: 'ls' }), 'Command')
  assert.equal(commandLabel({ url: 'https://a' }), 'Address')
  assert.equal(commandLabel({ path: '/tmp/x' }), 'File')
  assert.equal(commandLabel({ query: 'q' }), 'Query')
  assert.equal(commandLabel({ a: 1 }), 'Details')
})

test('isShellCommand: a non-empty command or cmd, not code, a script or an empty list', () => {
  assert.equal(isShellCommand({ command: 'pip install numpy' }), true)
  assert.equal(isShellCommand({ cmd: ['ls', '-la'] }), true)
  assert.equal(isShellCommand({ command: '', cmd: 'ls' }), true)
  assert.equal(isShellCommand({ code: 'import os' }), false)
  assert.equal(isShellCommand({ script: 'echo hi' }), false)
  assert.equal(isShellCommand({ command: [] }), false)
  assert.equal(isShellCommand(undefined), false)
})

test('gateTitle and whyAsked: plain words from the agent, the tool and the risk level', () => {
  assert.equal(gateTitle('Researcher', 'terminal'), 'Allow Researcher to use terminal?')
  assert.equal(gateTitle(undefined, 'terminal'), 'Allow the agent to use terminal?')
  assert.equal(gateTitle('Researcher', 'terminal', true), 'Researcher wants to run a command')
  assert.equal(gateTitle(undefined, 'terminal', true), 'The agent wants to run a command')
  const high = whyAsked('high', 'terminal', 'Researcher')
  assert.match(high[0], /marked high risk/)
  assert.match(high[1], /Approve lets Researcher run it once; Deny tells it to go on without this step\./)
  assert.match(whyAsked('critical', 'shell')[0], /marked critical risk/)
  assert.match(whyAsked('medium', 'write_file')[0], /does more than read/)
  assert.match(whyAsked(undefined, 'fetch')[0], /approval policy asks before fetch runs/)
  assert.match(whyAsked(undefined, 'fetch')[1], /lets the agent run it once/)
})

type Target = { closest(sel: string): unknown; isContentEditable?: boolean } | null
const key = (k: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat: boolean; defaultPrevented: boolean; target: Target }> = {}) => {
  const e = {
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    defaultPrevented: false,
    target: null as Target,
    prevented: false,
    preventDefault() {
      this.prevented = true
    },
    ...extra,
  }
  return e as typeof e & KeyboardEvent
}
const onBody: Target = { closest: () => null }
const inInput: Target = { closest: (sel: string) => (sel.includes('textarea') ? {} : null) }

test('keyDecision: A approves, D denies, case-insensitively; other keys do nothing', () => {
  assert.equal(keyDecision('a'), true)
  assert.equal(keyDecision('A'), true)
  assert.equal(keyDecision('d'), false)
  assert.equal(keyDecision('x'), null)
  assert.equal(keyDecision('Enter'), null)
})

test('ignoreKey: typing, dialogs, modifiers, repeats and handled events are left alone', () => {
  assert.equal(ignoreKey(key('a', { target: onBody })), false)
  assert.equal(ignoreKey(key('a', { target: inInput })), true)
  assert.equal(ignoreKey(key('a', { target: { closest: () => null, isContentEditable: true } })), true)
  assert.equal(ignoreKey(key('a', { ctrlKey: true })), true)
  assert.equal(ignoreKey(key('a', { metaKey: true })), true)
  assert.equal(ignoreKey(key('a', { altKey: true })), true)
  assert.equal(ignoreKey(key('a', { repeat: true })), true)
  assert.equal(ignoreKey(key('a', { defaultPrevented: true })), true)
})

test('the keys go to the newest open gate, and stop when every gate is gone', () => {
  const g = globalThis as unknown as { window?: unknown; addEventListener?: unknown; removeEventListener?: unknown }
  const listeners = new Set<unknown>()
  const savedWindow = g.window
  g.window = { addEventListener: (_: string, fn: unknown) => listeners.add(fn), removeEventListener: (_: string, fn: unknown) => listeners.delete(fn) }
  try {
    const got: string[] = []
    const older = { current: (ok: boolean) => void got.push(`older:${ok}`) }
    const newer = { current: (ok: boolean) => void got.push(`newer:${ok}`) }
    const offOlder = holdKeys(older)
    const offNewer = holdKeys(newer)
    assert.equal(listeners.size, 1, 'one window listener for all gates')
    const e = key('a', { target: onBody })
    assert.equal(handleGateKey(e), true)
    assert.equal(e.prevented, true)
    assert.equal(handleGateKey(key('d', { target: inInput })), false, 'typing in the composer')
    offNewer()
    handleGateKey(key('D', { target: onBody }))
    assert.deepEqual(got, ['newer:true', 'older:false'])
    offOlder()
    offOlder() // idempotent
    assert.equal(listeners.size, 0)
    assert.equal(handleGateKey(key('a', { target: onBody })), false, 'no gate, no action')
  } finally {
    g.window = savedWindow
  }
})
