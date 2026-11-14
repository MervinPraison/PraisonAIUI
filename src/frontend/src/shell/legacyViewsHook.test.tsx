// useLegacyViewRegistered reads the registry synchronously on the first render
// (no effect-driven second render), and is false when disabled.
import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { useLegacyViewRegistered } from './legacyViews'

const g = globalThis as unknown as Record<string, unknown>
if (typeof g.window === 'undefined') g.window = globalThis
const w = globalThis as unknown as { aiui?: Record<string, unknown> }

function Probe({ id, enabled }: { id: string; enabled: boolean }) {
  return <i data-has={String(useLegacyViewRegistered(id, enabled))} />
}

afterEach(() => {
  delete w.aiui
})

test('a registered view is seen on the first render', () => {
  w.aiui = { views: { 'custom-view': {} } }
  assert.match(renderToStaticMarkup(<Probe id="custom-view" enabled />), /data-has="true"/)
  assert.match(renderToStaticMarkup(<Probe id="other" enabled />), /data-has="false"/)
})

test('a queued view is seen on the first render', () => {
  w.aiui = { __queue: [['registerView', ['queued']]] }
  assert.match(renderToStaticMarkup(<Probe id="queued" enabled />), /data-has="true"/)
})

test('disabled always reports false', () => {
  w.aiui = { views: { 'custom-view': {} } }
  assert.match(renderToStaticMarkup(<Probe id="custom-view" enabled={false} />), /data-has="false"/)
})
