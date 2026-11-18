// Search words and ranking (searchRank.ts): stems, typos, prefixes, stop words, keywords.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { queryTerms, scoreDocMatch, stem, termMatch, tokenize } from './searchRank'

test('words are letters and digits in any script, lower case', () => {
    assert.deepEqual(tokenize('Set up `aiui.run()` in Café, v2!'), ['set', 'up', 'aiui', 'run', 'in', 'café', 'v2'])
})

test('question words go unless they are all the query has', () => {
    assert.deepEqual(queryTerms('How do I install the CLI?'), ['install', 'cli'])
    assert.deepEqual(queryTerms('how to'), ['how', 'to'])
})

test('the stemmer folds plurals, -ing, -ed and a final e', () => {
    for (const [a, b] of [['themes', 'theming'], ['install', 'installed'], ['policies', 'policy'], ['boxes', 'box'], ['configure', 'configuring']]) {
        assert.equal(stem(a), stem(b), `${a} ~ ${b}`)
    }
    assert.equal(stem('class'), 'class')
})

test('a word matches by stem, then by prefix, then with one typo', () => {
    assert.equal(termMatch('themes', 'theming'), 1)
    assert.equal(termMatch('inst', 'installation'), 0.7)
    assert.equal(termMatch('autentication', 'authentication'), 0.5)
    assert.equal(termMatch('tokne', 'token'), 0.5)
    // Short words need the exact word: no typo or one-letter prefix noise.
    assert.equal(termMatch('cat', 'car'), 0)
    assert.equal(termMatch('a', 'api'), 0)
})

test('keywords and forgiving title words count, below a plain title match', () => {
    assert.ok(scoreDocMatch('Authentication', 'API', 'login', ['login', 'sign in']) > 0)
    assert.equal(scoreDocMatch('Authentication', 'API', 'login'), 0)
    const exact = scoreDocMatch('Authentication', 'API', 'authentication')
    const typo = scoreDocMatch('Authentication', 'API', 'authentcation')
    assert.ok(exact > typo && typo > 0)
})
