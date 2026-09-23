/**
 * Unit tests for the Agent-UI adapter (mock events -> stable contracts).
 *
 * Dependency-free: uses the Node built-in test runner so it needs no extra
 * toolchain. Run with `npm test` (from src/frontend), which invokes the Node
 * test runner with `--experimental-strip-types` so the TypeScript types are
 * stripped on Node 22+. The frontend CI gate (see issue #295) wires this in.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mapApprovalToCardProps, mapChatEventToUi } from './adapter.ts'

test('mapChatEventToUi normalizes a streaming token frame', () => {
    const event = mapChatEventToUi({
        type: 'run_content',
        token: 'Hello',
        agent_name: 'Researcher',
        session_id: 's1',
        run_id: 'r1',
    })
    assert.equal(event.kind, 'run-token')
    assert.equal(event.text, 'Hello')
    assert.equal(event.agentName, 'Researcher')
    assert.equal(event.sessionId, 's1')
    assert.equal(event.runId, 'r1')
})

test('mapChatEventToUi maps a started tool call to a running chip', () => {
    const event = mapChatEventToUi({
        type: 'tool_call_started',
        name: 'search',
        description: '🔎 Searching the web',
        icon: '🔎',
        step_number: 2,
        tool_call_id: 'tc-1',
    })
    assert.equal(event.kind, 'tool-call')
    assert.deepEqual(event.toolCall, {
        id: 'tc-1',
        label: '🔎 Searching the web',
        icon: '🔎',
        stepNumber: 2,
        status: 'running',
        error: undefined,
    })
})

test('mapChatEventToUi marks completed tool calls as done', () => {
    const event = mapChatEventToUi({ type: 'tool_call_completed', name: 'search' })
    assert.equal(event.toolCall?.status, 'done')
    // Falls back to the tool name for id and label when unspecified.
    assert.equal(event.toolCall?.id, 'search')
    assert.equal(event.toolCall?.label, 'search')
})

test('mapChatEventToUi treats team_* frames the same as their solo variant', () => {
    assert.equal(mapChatEventToUi({ type: 'team_run_content', token: 'x' }).kind, 'run-token')
    assert.equal(mapChatEventToUi({ type: 'team_run_error', error: 'boom' }).kind, 'run-error')
})

test('mapChatEventToUi preserves unknown frame types without throwing', () => {
    const event = mapChatEventToUi({ type: 'future_event', foo: 'bar' })
    assert.equal(event.kind, 'unknown')
    assert.equal(event.rawType, 'future_event')
})

test('mapChatEventToUi defaults run errors to a readable message', () => {
    const event = mapChatEventToUi({ type: 'run_error' })
    assert.equal(event.kind, 'run-error')
    assert.equal(event.error, 'Unknown error')
})

test('mapApprovalToCardProps maps a pending approval item', () => {
    const card = mapApprovalToCardProps({
        id: 'a-1',
        tool_name: 'delete_file',
        agent_name: 'Ops',
        risk_level: 'high',
        risk_icon: '🔥',
        description: 'Deletes a file',
        arguments: { path: '/tmp/x' },
        created_at: '2026-09-23T00:00:00Z',
    })
    assert.equal(card.id, 'a-1')
    assert.equal(card.toolName, 'delete_file')
    assert.equal(card.agentName, 'Ops')
    assert.equal(card.riskLevel, 'high')
    assert.equal(card.riskIcon, '🔥')
    assert.equal(card.argumentsJson, '{\n  "path": "/tmp/x"\n}')
})

test('mapApprovalToCardProps falls back for missing/invalid fields', () => {
    const card = mapApprovalToCardProps({ id: 'a-2', risk_level: 'nonsense' })
    assert.equal(card.toolName, 'unknown')
    assert.equal(card.agentName, 'Unknown')
    assert.equal(card.riskLevel, 'medium')
    assert.equal(card.riskIcon, '⚠️')
    assert.equal(card.argumentsJson, '{}')
})
