// Printing a docs page (print.ts): always light on paper, the reader's theme back after.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { printLight, printPage } from './print'

function fakeWindow(dark: boolean) {
    const classes = new Set(dark ? ['dark'] : [])
    const target = new EventTarget()
    const win = {
        addEventListener: target.addEventListener.bind(target),
        removeEventListener: target.removeEventListener.bind(target),
        document: {
            documentElement: {
                classList: {
                    add: (c: string) => void classes.add(c),
                    remove: (c: string) => void classes.delete(c),
                    contains: (c: string) => classes.has(c),
                },
            },
        },
    }
    const fire = (type: string) => target.dispatchEvent(new Event(type))
    return { win, classes, fire }
}

test('a dark page prints light and is dark again after printing', () => {
    const { win, classes, fire } = fakeWindow(true)
    const stop = printLight(win as never)
    fire('beforeprint')
    assert.equal(classes.has('dark'), false)
    fire('afterprint')
    assert.equal(classes.has('dark'), true)
    stop()
})

test('a light page stays light, and cleanup mid-print restores dark and stops listening', () => {
    const light = fakeWindow(false)
    const stopLight = printLight(light.win as never)
    light.fire('beforeprint')
    light.fire('afterprint')
    assert.equal(light.classes.has('dark'), false)
    stopLight()

    const dark = fakeWindow(true)
    const stop = printLight(dark.win as never)
    dark.fire('beforeprint')
    stop()
    assert.equal(dark.classes.has('dark'), true)
    dark.fire('beforeprint')
    assert.equal(dark.classes.has('dark'), true)
})

test('the page action prints on the next task, after the menu closes', () => {
    const calls: string[] = []
    let queued: (() => void) | undefined
    printPage({ print: () => calls.push('print'), setTimeout: ((fn: () => void) => ((queued = fn), 0)) as never })
    assert.deepEqual(calls, [])
    queued?.()
    assert.deepEqual(calls, ['print'])
})
