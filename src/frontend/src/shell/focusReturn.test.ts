// Focus return for the shell's trigger-less dialogs (shell/focusReturn.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFocusReturn, MAIN_ID } from '@/shell/focusReturn'

function fakeDoc() {
  const focused: string[] = []
  const el = (name: string, connected = true) => ({
    name,
    isConnected: connected,
    focus: (opts?: FocusOptions) => {
      assert.deepEqual(opts, { preventScroll: true })
      focused.push(name)
    },
  })
  const body = el('body')
  const main = el('main')
  const doc = {
    body,
    activeElement: body as unknown,
    getElementById: (id: string) => (id === MAIN_ID ? main : null),
  }
  return { doc, el, focused }
}

const closeEvent = () => {
  let prevented = false
  return {
    event: { preventDefault: () => void (prevented = true) } as unknown as Event,
    prevented: () => prevented,
  }
}

test('closing puts focus back on the element that had it when the dialog opened', () => {
  const { doc, el, focused } = fakeDoc()
  const ret = createFocusReturn(doc as unknown as Document)
  doc.activeElement = el('composer')
  ret.capture()
  doc.activeElement = el('palette-input')
  const { event, prevented } = closeEvent()
  ret.restore(event)
  assert.equal(prevented(), true, "radix's focus-the-trigger default (a null trigger → <body>) is cancelled")
  assert.deepEqual(focused, ['composer'])
  ret.restore(closeEvent().event)
  assert.deepEqual(focused, ['composer'], 'restores once')
})

test('after navigating, focus lands on the main region; nothing focusable means no focus call', () => {
  const { doc, el, focused } = fakeDoc()
  const ret = createFocusReturn(doc as unknown as Document)
  doc.activeElement = el('search-button')
  ret.capture()
  ret.toMain()
  ret.restore(closeEvent().event)
  assert.deepEqual(focused, ['main'])

  doc.activeElement = doc.body
  ret.capture()
  ret.restore(closeEvent().event)
  assert.deepEqual(focused, ['main'], 'opened from <body>: nothing to restore')

  doc.activeElement = el('removed', false)
  ret.capture()
  ret.restore(closeEvent().event)
  assert.deepEqual(focused, ['main'], 'an element that left the page is not focused')
})

test('without a document it does nothing', () => {
  const ret = createFocusReturn(undefined)
  ret.capture()
  ret.toMain()
  const { event, prevented } = closeEvent()
  ret.restore(event)
  assert.equal(prevented(), true)
})
