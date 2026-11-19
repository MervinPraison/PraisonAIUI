// "Listen to page" (listen.ts): the article text cut into utterances an engine reads whole.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { speechChunks } from './listen'

test('short blocks are one utterance each', () => {
    assert.deepEqual(speechChunks(['Install', 'Run aiui build. Then serve it.']), ['Install', 'Run aiui build. Then serve it.'])
})

test('a long block splits at sentence ends, never past the limit', () => {
    const block = 'One sentence here. Another sentence there! A third one? And the last.'
    const chunks = speechChunks([block], 40)
    assert.ok(chunks.length > 1)
    assert.ok(chunks.every((c) => c.length <= 40))
    assert.equal(chunks.join(' '), block)
})

test('a sentence longer than the limit splits at spaces', () => {
    const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
    const chunks = speechChunks([words], 50)
    assert.ok(chunks.every((c) => c.length <= 50))
    assert.equal(chunks.join(' ').split(' ').length, 60)
})

test('nothing to read is no utterance', () => {
    assert.deepEqual(speechChunks([]), [])
    assert.deepEqual(speechChunks(['   ']), [])
})
