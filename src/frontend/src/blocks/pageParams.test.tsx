// Page params, auto refresh back-off and the status block
// (blocks/pageParams.ts, blocks/pageBlocks.tsx). No DOM: pure functions, a
// minimal window fake and static markup.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import '@/blocks/coreBlocks'
import { getCoreBlock } from '@/blocks/coreBlocks'
import { MAX_BACKOFF_MS, mergeSearch, nextRefreshDelay, refreshSeconds, withQuery, writeParams } from '@/blocks/pageParams'
import { StatusBlock } from '@/blocks/pageBlocks'
import type { BlockNode } from '@/sdk/registry'

test('withQuery appends to an endpoint with or without a query', () => {
  assert.equal(withQuery('/api/pages/x/data', '?a=1'), '/api/pages/x/data?a=1')
  assert.equal(withQuery('/api/plugins/p/data?v=2', '?a=1'), '/api/plugins/p/data?v=2&a=1')
  assert.equal(withQuery('/api/pages/x/data', ''), '/api/pages/x/data')
})

test('mergeSearch replaces submitted keys, drops empties, keeps the rest', () => {
  const values = { channel: 'new one', days: '', tags: ['a', 'b'], live: true, off: false, _private: 'x' }
  const merged = mergeSearch('?layout=pro&channel=old&days=7', values)
  assert.equal(merged, '?layout=pro&channel=new+one&tags=a&tags=b&live=true')
  assert.equal(mergeSearch('?a=1', { a: null }), '')
})

test('writeParams uses replaceState and keeps path and hash', () => {
  const calls: string[] = []
  const g = globalThis as { window?: unknown }
  const prev = g.window
  g.window = {
    location: { pathname: '/sales', search: '?layout=pro', hash: '#top' },
    history: { state: { pageId: 'sales' }, replaceState: (_s: unknown, _t: string, url: string) => calls.push(url) },
  }
  try {
    writeParams({ region: 'eu' })
    writeParams({ layout: 'pro' }) // unchanged: no history write
  } finally {
    g.window = prev
  }
  assert.deepEqual(calls, ['/sales?layout=pro&region=eu#top'])
})

test('auto refresh: seconds parsing and back-off', () => {
  assert.equal(refreshSeconds(5), 5)
  assert.equal(refreshSeconds('10'), 10)
  assert.equal(refreshSeconds(0.2), 1)
  assert.equal(refreshSeconds(undefined), 0)
  assert.equal(refreshSeconds(-3), 0)
  assert.equal(nextRefreshDelay(5, 0), 5000)
  assert.equal(nextRefreshDelay(5, 1), 10000)
  assert.equal(nextRefreshDelay(5, 3), 40000)
  assert.equal(nextRefreshDelay(5, 50), MAX_BACKOFF_MS)
  // a period longer than the cap is never shortened by failures
  assert.equal(nextRefreshDelay(600, 2), 600_000)
})

const node = (type: string, props: Record<string, unknown>): BlockNode => ({ type, props })

test('status block: state, detail, progress and log', () => {
  const html = renderToStaticMarkup(
    <StatusBlock node={node('status', { label: 'Sync YouTube', state: 'running', detail: '12 of 40', progress: 30, log: ['start'] })} />,
  )
  assert.match(html, /data-state="running"/)
  assert.match(html, /Sync YouTube/)
  assert.match(html, /Running/)
  assert.match(html, /12 of 40/)
  assert.match(html, /aria-valuenow="30"/)
  assert.match(html, /aria-live="polite"/)
  const failed = renderToStaticMarkup(<StatusBlock node={node('status', { label: 'X', state: 'nope' })} />)
  assert.match(failed, /data-state="running"/) // unknown state falls back
  assert.doesNotMatch(failed, /progressbar/)
  assert.ok(getCoreBlock('status'), 'status is a core block')
})
