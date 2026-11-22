// afterLoad.ts: optional work never starts while the page is loading (the load event would wait on it).
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { afterLoad, type LoadEnv } from './afterLoad'

function fakeEnv(readyState: DocumentReadyState) {
    const listeners = new Map<string, () => void>()
    const idle: (() => void)[] = []
    const env = {
        doc: { readyState },
        win: {
            addEventListener: (type: string, fn: () => void) => void listeners.set(type, fn),
            removeEventListener: (type: string) => void listeners.delete(type),
            requestIdleCallback: (fn: () => void) => idle.push(fn),
            cancelIdleCallback: (id: number) => void (idle[id - 1] = () => {}),
        },
    }
    return {
        env: env as unknown as LoadEnv,
        load: () => { env.doc.readyState = 'complete'; listeners.get('load')?.() },
        runIdle: () => idle.splice(0).forEach((fn) => fn()),
        listening: () => listeners.has('load'),
    }
}

describe('afterLoad', () => {
    test('while the page loads: nothing runs until load, then at idle', () => {
        const f = fakeEnv('interactive')
        let ran = 0
        afterLoad(() => { ran += 1 }, f.env)
        f.runIdle()
        assert.equal(ran, 0)
        f.load()
        assert.equal(ran, 0) // load reached: still waits for idle
        f.runIdle()
        assert.equal(ran, 1)
    })

    test('a loaded page runs it at idle', () => {
        const f = fakeEnv('complete')
        let ran = 0
        afterLoad(() => { ran += 1 }, f.env)
        f.runIdle()
        assert.equal(ran, 1)
    })

    test('cancelled before load: never runs and stops listening', () => {
        const f = fakeEnv('loading')
        let ran = 0
        const cancel = afterLoad(() => { ran += 1 }, f.env)
        cancel()
        assert.equal(f.listening(), false)
        f.load()
        f.runIdle()
        assert.equal(ran, 0)
    })

    test('no browser (tests, server rendering): a no-op', () => {
        assert.doesNotThrow(() => afterLoad(() => { throw new Error('ran') }, null)())
    })
})
