// The viewers' copy of the chat's media URL policy must answer exactly as
// chat-engine/util does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as chat from '@/chat-engine/util'
import { hostOf, isTrustedUrl, safeUrl } from './urls'

const g = globalThis as unknown as Record<string, unknown>
g.location = { href: 'http://app.test/chat', origin: 'http://app.test' }

const URLS = [
  '/files/a.png', 'files/a.png', 'http://app.test/x.png', 'https://other.example/x.png', 'http://other.example:8080/v.mp4',
  'blob:http://app.test/1', 'data:image/png;base64,AAAA', 'DATA:IMAGE/png;base64,AA', 'data:text/html,<b>x</b>',
  'javascript:alert(1)', ' JavaScript:alert(1)', 'vbscript:x', '//evil.example/p.png', '', '   ', 'mailto:a@b.c',
]

test('safeUrl, isTrustedUrl and hostOf match chat-engine/util', () => {
  for (const u of URLS) {
    assert.equal(safeUrl(u), chat.safeUrl(u), `safeUrl(${JSON.stringify(u)})`)
    assert.equal(isTrustedUrl(u), chat.isTrustedImageUrl(u), `isTrusted(${JSON.stringify(u)})`)
    assert.equal(hostOf(u), chat.hostOf(u), `hostOf(${JSON.stringify(u)})`)
  }
  assert.equal(safeUrl(42), chat.safeUrl(42))
})
