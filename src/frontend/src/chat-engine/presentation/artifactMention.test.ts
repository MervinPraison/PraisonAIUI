// The composer's "@" (ArtifactMention): the inserted text and the list of titles.
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('insertMention: @"title" at the caret, taking over an @ just typed; quotes inside are softened', async () => {
  const { insertMention } = await import('./ArtifactMention')
  assert.deepEqual(insertMention('', 0, 0, 'Model table', false), { text: '@"Model table" ', caret: 15 })
  assert.deepEqual(insertMention('fix @', 5, 5, 'Model table', true), { text: 'fix @"Model table" ', caret: 19 })
  assert.deepEqual(insertMention('fix', 3, 3, 'a "b"', false), { text: 'fix @"a \'b\'" ', caret: 13 })
  assert.equal(insertMention('use  later', 4, 4, 'T', false).text, 'use @"T"  later')
  const { mentionTitles } = await import('./ArtifactMention')
  const v = (key: string, title: string) => ({ key, title, kind: 'table', version: 1, sessionId: 's', messageId: 'm' }) as const
  assert.deepEqual(mentionTitles([v('a', 'Old'), v('b', 'B'), v('a', 'New')]), [{ key: 'a', title: 'New' }, { key: 'b', title: 'B' }])
})
