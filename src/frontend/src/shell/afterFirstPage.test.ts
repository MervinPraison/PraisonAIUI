// afterFirstPage (shell/palette.ts): warm-ups wait for the routed page.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const win = new EventTarget() as EventTarget & { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout }
win.setTimeout = setTimeout
win.clearTimeout = clearTimeout
;(globalThis as { window?: unknown }).window = win

const { afterFirstPage } = await import('@/shell/palette')
const { PAGE_CHANGE_EVENT } = await import('@/shell/router')
const shown = () => win.dispatchEvent(new CustomEvent(PAGE_CHANGE_EVENT, { detail: { pageId: 'chat' } }))

test('runs once, when the first page is on screen', () => {
  let runs = 0
  const cancel = afterFirstPage(() => {
    runs += 1
  })
  assert.equal(runs, 0, 'not before the page')
  shown()
  shown()
  assert.equal(runs, 1)
  cancel()
})

test('runs after the timeout when no page announces itself, and cancels cleanly', async () => {
  let runs = 0
  afterFirstPage(() => {
    runs += 1
  }, 10)
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(runs, 1)

  let cleaned = 0
  const cancel = afterFirstPage(() => () => {
    cleaned += 1
  })
  shown()
  cancel()
  assert.equal(cleaned, 1, "the callback's cleanup runs on cancel")

  let never = 0
  const early = afterFirstPage(() => {
    never += 1
  }, 10)
  early()
  shown()
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(never, 0, 'cancelled before the page: never runs')
})
