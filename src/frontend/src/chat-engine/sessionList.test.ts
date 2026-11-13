// npm test -- chat-engine/sessionList
// The rail's merge of the server list with chats started on this page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ChatSession } from './api'
import { addLocalSession, markListed, mergeSessions, removeLocalSession, renameLocalSession, type LocalSessions } from './sessionList'

const row = (id: string, title = `Chat ${id}`, untitled = false): ChatSession => ({ id, title, untitled, updatedAt: 1 })
const ids = (list: ChatSession[]) => list.map((s) => s.id)

test('a chat started here is listed before the server knows it, then once the server lists it', () => {
  let local: LocalSessions = {}
  local = addLocalSession(local, 'new', 'after restart', 100)
  assert.deepEqual(mergeSessions([row('old')], local).map((s) => [s.id, s.title]), [['new', 'after restart'], ['old', 'Chat old']])

  const server = [row('new', 'Chat new', true), row('old')]
  local = markListed(local, server)
  const shown = mergeSessions(server, local)
  assert.deepEqual(ids(shown), ['new', 'old'], 'not shown twice')
  assert.equal(shown[0].title, 'after restart', 'the local title stands in for an untitled server row')
})

test('regression: a chat created on this page and then deleted is gone from the rail', () => {
  // The verifier's case: send, the server lists the chat, delete it from the rail.
  let local = addLocalSession({}, 'S1', 'after restart')
  let server = [row('S1', 'Chat S1', true)]
  local = markListed(local, server)
  assert.deepEqual(ids(mergeSessions(server, local)), ['S1'])

  server = server.filter((s) => s.id !== 'S1')
  local = removeLocalSession(local, 'S1')
  assert.deepEqual(ids(mergeSessions(server, local)), [], 'the local entry does not resurrect it')
  assert.ok(!('S1' in local))

  // Deleted before the server ever listed it.
  local = addLocalSession({}, 'S2', 'quick one')
  local = removeLocalSession(local, 'S2')
  assert.deepEqual(ids(mergeSessions([], local)), [])
})

test('a listed chat that the server stops listing (deleted elsewhere) does not come back as a local row', () => {
  let local = addLocalSession({}, 'S1', 'hello')
  local = markListed(local, [row('S1')])
  assert.deepEqual(ids(mergeSessions([], local)), [])
})

test('renaming a chat the server has not listed yet shows the new title at once', () => {
  let local = addLocalSession({}, 'S1', 'first message')
  local = renameLocalSession(local, 'S1', 'Renamed')
  assert.equal(mergeSessions([], local)[0].title, 'Renamed')
  // unknown ids are left alone, and unchanged maps keep their identity (no extra renders)
  assert.equal(renameLocalSession(local, 'nope', 'x'), local)
  assert.equal(removeLocalSession(local, 'nope'), local)
  assert.equal(markListed(local, []), local)
})

test('unlisted local chats are shown newest first', () => {
  let local = addLocalSession({}, 'a', 'A', 1)
  local = addLocalSession(local, 'b', 'B', 2)
  assert.deepEqual(ids(mergeSessions([], local)), ['b', 'a'])
})
