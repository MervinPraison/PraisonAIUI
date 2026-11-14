// retryableLazy (lib/retryableLazy.ts): a failed chunk load can be imported again.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lazy, Suspense, type ComponentType } from 'react'
import { prerenderToNodeStream } from 'react-dom/static'
import { retryableLazy, retryFailedLazies } from '@/lib/retryableLazy'

async function render(C: ComponentType<{ label: string }>): Promise<string> {
  const { prelude } = await prerenderToNodeStream(
    <Suspense fallback={<i>loading</i>}>
      <C label="ok" />
    </Suspense>,
    { onError: () => {} },
  )
  let html = ''
  for await (const chunk of prelude) html += String(chunk)
  return html
}

/** A loader that fails like a chunk 404 while `broken`, then works. */
function flakyLoader() {
  let calls = 0
  let broken = true
  const Page = ({ label }: { label: string }) => <b>{label}</b>
  const load = () => {
    calls += 1
    return broken
      ? Promise.reject(new TypeError('Failed to fetch dynamically imported module'))
      : Promise.resolve({ default: Page })
  }
  return {
    load,
    calls: () => calls,
    fix: () => {
      broken = false
    },
  }
}

test('a failed import keeps its error until a retry, then imports again', async () => {
  const flaky = flakyLoader()
  const C = retryableLazy(flaky.load)
  assert.doesNotMatch(await render(C), /<b>ok<\/b>/, 'the first mount fails')
  flaky.fix()
  assert.doesNotMatch(await render(C), /<b>ok<\/b>/, 'no silent retry loop: the error stays for the boundary')
  assert.equal(flaky.calls(), 1)
  retryFailedLazies()
  assert.match(await render(C), /<b>ok<\/b>/, 'after a retry the next render imports again')
  assert.equal(flaky.calls(), 2)
  retryFailedLazies()
  assert.match(await render(C), /<b>ok<\/b>/)
  assert.equal(flaky.calls(), 2, 'a loaded chunk is never imported again')
})

test('plain React.lazy keeps the rejection forever (why the helper exists)', async () => {
  const flaky = flakyLoader()
  const C = lazy(flaky.load)
  assert.doesNotMatch(await render(C), /<b>ok<\/b>/)
  flaky.fix()
  retryFailedLazies()
  assert.doesNotMatch(await render(C), /<b>ok<\/b>/)
})
