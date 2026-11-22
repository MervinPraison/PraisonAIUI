// networkChange.ts: `online` and waking up (visible again) are heard; going hidden is not.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { onNetworkChange, type NetworkEnv } from './networkChange'

test('online and visible-again call back; hidden does not; the remover stops it', () => {
    const win = new EventTarget()
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState })
    let calls = 0
    const stop = onNetworkChange(() => { calls += 1 }, { win, doc } as unknown as NetworkEnv)
    win.dispatchEvent(new Event('online'))
    assert.equal(calls, 1)
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    assert.equal(calls, 1)
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    assert.equal(calls, 2)
    stop()
    win.dispatchEvent(new Event('online'))
    assert.equal(calls, 2)
    assert.doesNotThrow(() => onNetworkChange(() => {}, null)())
})
