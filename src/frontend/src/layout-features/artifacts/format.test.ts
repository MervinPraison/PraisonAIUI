// What the canvas says about an artifact, and what Copy, Download and Share hand over.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveArtifacts, type DerivedArtifact } from './derive'
import { sortingConversation } from './fixtures'
import { canDownload, cardMeta, clockTime, copyText, describeVersion, downloadOf, kindLine, lineDiff, parseShareQuery, relativeTime, shareUrl } from './format'

const [t1, t2, code] = deriveArtifacts(sortingConversation(), 's1').versions

test('card lines match the design', () => {
  assert.equal(cardMeta(t2), 'Table · 3 rows · v2 · edited by Researcher')
  assert.equal(cardMeta(t2, { compact: true }), 'Table · 3 rows · v2')
  assert.equal(cardMeta(code, { runnable: true }), 'Python · 5 lines · runnable')
  assert.equal(cardMeta({ ...t2, edited: true }), 'Table · 3 rows · v2 · edited by you')
  assert.equal(kindLine({ ...code, kind: 'image' }), 'Image')
  assert.equal(kindLine({ ...code, kind: 'a2ui' }), 'Interactive view')
})

test('history lines', () => {
  assert.equal(describeVersion(t1, undefined), 'Researcher created the table')
  assert.equal(describeVersion(t2, t1), 'Researcher added the Stable column')
  assert.equal(describeVersion(t1, t2), 'Researcher removed the Stable column')
  assert.equal(describeVersion({ ...t2, rows: 5, columns: t1.columns }, t1), 'Researcher changed it to 5 rows')
  assert.equal(describeVersion({ ...code, content: `${code.content}\nprint(len(data))` }, code), 'Researcher changed the file (+1 −0)')
  assert.equal(describeVersion({ ...t1, edited: true, restoredFrom: 1 }, t2), 'You restored v1')
  assert.equal(describeVersion({ ...code, agent: undefined }, undefined), 'The agent created the file')
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nc\nd\ne'), { added: 2, removed: 1 })
})

test('times', () => {
  const now = Date.UTC(2026, 0, 2, 12, 0)
  assert.equal(relativeTime(now - 10_000, now), 'just now')
  assert.equal(relativeTime(now - 120_000, now), '2 min ago')
  assert.equal(relativeTime(now - 3 * 3600_000, now), '3 h ago')
  assert.equal(relativeTime(now - 30 * 3600_000, now), 'yesterday')
  assert.equal(relativeTime(now - 4 * 86400_000, now), '4 days ago')
  assert.equal(relativeTime(undefined), '')
  assert.match(clockTime(now), /^\d\d:\d\d$/)
})

test('download: CSV for tables, the file name for named code, a slug otherwise, the URL for media', () => {
  const t = downloadOf(t2)
  assert.equal(t.filename, 'comparison-table.csv')
  assert.equal(t.mime, 'text/csv')
  assert.match(t.text ?? '', /^Algorithm,Average,Worst,Stable\r\nQuicksort,O\(n log n\),O\(n²\),No\r\n/)
  assert.deepEqual(downloadOf(code), { filename: 'sort_demo.py', mime: 'text/plain', text: code.content })
  const unnamed: DerivedArtifact = { ...code, key: 'code:python:1', title: 'Python code' }
  assert.equal(downloadOf(unnamed).filename, 'python-code.py')
  assert.equal(downloadOf({ ...code, key: 'src/app/main.ts', language: 'typescript' }).filename, 'main.ts')
  assert.equal(downloadOf({ ...code, kind: 'markdown', key: 'markdown:1', title: 'Release notes' }).filename, 'release-notes.md')
  assert.deepEqual(downloadOf({ ...code, kind: 'image', key: 'file:chart.png', url: '/f/chart.png', mimeType: 'image/png', content: undefined }), {
    filename: 'chart.png',
    mime: 'image/png',
    url: '/f/chart.png',
  })
  assert.equal(copyText(t2), t2.content)
  assert.equal(copyText({ ...code, content: undefined, url: '/x' }), '/x')
})

test('download and copy: a media URL from agent output goes through the viewers\' URL policy', () => {
  const file = (url: string): DerivedArtifact => ({ ...code, kind: 'file', key: 'file:report.txt', title: 'report.txt', url, content: undefined, mimeType: undefined })
  for (const bad of ["javascript:document.title='PWNED'", ' JavaScript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', '']) {
    assert.equal(downloadOf(file(bad)).url, undefined, `no download URL for ${JSON.stringify(bad)}`)
    assert.equal(canDownload(file(bad)), false, `Download hidden for ${JSON.stringify(bad)}`)
    assert.equal(copyText(file(bad)), '', `Copy hidden for ${JSON.stringify(bad)}`)
  }
  for (const ok of ['/files/r.txt', 'https://example.com/r.txt', 'blob:http://app.test/1', 'data:image/png;base64,AAAA']) {
    assert.equal(downloadOf(file(ok)).url, ok)
    assert.equal(canDownload(file(ok)), true)
    assert.equal(copyText(file(ok)), ok)
  }
  assert.equal(canDownload(t2), true, 'text artifacts always download')
})

test('share links round-trip', () => {
  const url = shareUrl(t2, 'http://app.test')
  assert.equal(url, 'http://app.test/artifacts?session=s1&artifact=table%3Aalgorithm%7Caverage%7Cworst&v=2')
  assert.deepEqual(parseShareQuery(new URL(url).search), { sessionId: 's1', key: 'table:algorithm|average|worst', version: 2 })
  assert.equal(parseShareQuery('?session=s1'), null)
  assert.deepEqual(parseShareQuery('?session=s&artifact=k&v=zz'), { sessionId: 's', key: 'k', version: undefined })
})
