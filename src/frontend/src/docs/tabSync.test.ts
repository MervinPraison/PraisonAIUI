// Tab sync by title (tabSync.ts): the latest pick a set has wins, then defaultTabIndex.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chosenTab, pickTab, snapshot, subscribe } from './tabSync'

test('a set shows its title picked most recently, else defaultTabIndex, else the first', () => {
    const titles = ['Linux', 'macOS', 'Windows']
    assert.equal(chosenTab(titles, []), 0)
    assert.equal(chosenTab(titles, [], 2), 2)
    assert.equal(chosenTab(titles, [], 9), 0) // out of range
    assert.equal(chosenTab(titles, ['pnpm', 'Windows', 'macOS'], 0), 2) // 'pnpm' is not here; Windows is newer than macOS
})

test('picking a title notifies every set and moves it to the front (no storage: still works)', () => {
    let calls = 0
    const stop = subscribe(() => calls++)
    pickTab('macOS')
    pickTab('pnpm')
    pickTab('macOS')
    stop()
    pickTab('Windows')
    assert.equal(calls, 3)
    assert.deepEqual(snapshot().slice(0, 3), ['Windows', 'macOS', 'pnpm'])
})
