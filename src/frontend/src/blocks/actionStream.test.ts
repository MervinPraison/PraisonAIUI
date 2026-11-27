import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import StudioBlock from '../studio/StudioBlocks'
import { isNdjsonContentType, readNdjsonStream } from './actionStream'

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
}

test('isNdjsonContentType recognizes ndjson with or without charset', () => {
  assert.equal(isNdjsonContentType('application/x-ndjson'), true)
  assert.equal(isNdjsonContentType('application/x-ndjson; charset=utf-8'), true)
  assert.equal(isNdjsonContentType('application/json'), false)
  assert.equal(isNdjsonContentType(null), false)
})

test('readNdjsonStream parses frames split across chunk boundaries', async () => {
  const frames: unknown[] = []
  const body = streamFromChunks([
    '{"_components":[{"type":"text","content":"a"}]}\n{"_com',
    'ponents":[{"type":"text","content":"ab"}]}\n\n{"message":"done"}',
  ])
  await readNdjsonStream(body, (f) => frames.push(f))
  assert.deepEqual(frames, [
    { _components: [{ type: 'text', content: 'a' }] },
    { _components: [{ type: 'text', content: 'ab' }] },
    { message: 'done' },
  ])
})

test('readNdjsonStream stops cleanly when aborted', async () => {
  const ac = new AbortController()
  const frames: unknown[] = []
  const enc = new TextEncoder()
  let i = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      i += 1
      if (i === 1) controller.enqueue(enc.encode('{"step":1}\n'))
      else if (i === 2) {
        ac.abort()
        controller.enqueue(enc.encode('{"step":2}\n'))
      } else {
        controller.close()
      }
    },
  })
  await readNdjsonStream(body, (f) => frames.push(f), ac.signal)
  assert.deepEqual(frames, [{ step: 1 }])
})

test('StudioBlock renders Save button for sheet when action prop is configured', () => {
  const withoutSave = renderToStaticMarkup(
    createElement(StudioBlock, {
      node: { type: 'sheet', props: { title: 'Data', headers: ['A'], rows: [[1]] } },
    }),
  )
  assert.doesNotMatch(withoutSave, />Save</)

  const withSave = renderToStaticMarkup(
    createElement(StudioBlock, {
      node: {
        type: 'sheet',
        props: { title: 'Data', headers: ['A'], rows: [[1]], action: 'save_data', save_label: 'Save edits' },
      },
    }),
  )
  assert.match(withSave, />Save edits</)
})
