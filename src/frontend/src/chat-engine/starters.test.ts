// npm test -- chat-engine/starters
// Template starters fill the composer; they are never sent as fragments.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_STARTERS, fillPrompts } from './starters'

test('every default starter is a template that fills the composer (G3)', () => {
  assert.ok(DEFAULT_STARTERS.length > 0)
  for (const s of DEFAULT_STARTERS) assert.equal(s.fill, true, `${s.title} fills, not sends`)
  // No default asks about an attachment that is not there.
  assert.ok(!DEFAULT_STARTERS.some((s) => /the attached/i.test(s.prompt)))
})

test('fillPrompts lists only the starters marked fill', () => {
  const set = fillPrompts([{ prompt: 'Send me' }, { prompt: 'Finish: ', fill: true }])
  assert.deepEqual([...set], ['Finish: '])
  assert.equal(fillPrompts(undefined).size, 0)
})
