// The artifact rules (derive.ts): fences, tables, elements, A2UI surfaces,
// keys, versions, and the same result after a history reload.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  boundKey,
  MAX_KEY,
  deriveArtifacts,
  isLarge,
  languageName,
  parseInfo,
  parseTable,
  plainText,
  scanMarkdown,
  splitRow,
  tableToCsv,
  type DeriveMessage,
} from './derive'
import { reply, sortingConversation, T0, TABLE_V2 } from './fixtures'

test('the sorting fixture yields "Comparison table" v2 and "sort_demo.py" v1', () => {
  const msgs = sortingConversation()
  const { versions, mentions } = deriveArtifacts(msgs, 's1')
  assert.deepEqual(
    versions.map((v) => [v.key, v.title, v.version, v.kind]),
    [
      ['table:algorithm|average|worst', 'Comparison table', 1, 'table'],
      ['table:algorithm|average|worst', 'Comparison table', 2, 'table'],
      ['sort_demo.py', 'sort_demo.py', 1, 'code'],
    ],
  )
  const [t1, t2, code] = versions
  assert.equal(t1.rows, 3)
  assert.deepEqual(t2.columns, ['Algorithm', 'Average', 'Worst', 'Stable'])
  assert.equal(t2.messageId, msgs[3].id)
  assert.equal(t2.updatedAt, T0 + 121_000)
  assert.equal(t2.agent, 'Researcher')
  assert.equal(t2.sessionId, 's1')
  assert.equal(code.language, 'python')
  assert.equal(code.lines, 5)
  assert.match(code.content ?? '', /^import random\n\ndata = /)
  // Each reply mentions what it showed: the first both, the second the new table.
  assert.deepEqual(mentions[msgs[1].id].map((v) => `${v.title} v${v.version}`), ['Comparison table v1', 'sort_demo.py v1'])
  assert.deepEqual(mentions[msgs[3].id].map((v) => `${v.title} v${v.version}`), ['Comparison table v2'])
  assert.equal(mentions[msgs[0].id], undefined, 'user messages make no artifacts')
})

test('a history reload (new message ids, same content) gives the same keys and versions', () => {
  const live = deriveArtifacts(sortingConversation(), 's1')
  const reloaded = sortingConversation().map((m, i) => ({ ...m, id: `h_${i}` }))
  const again = deriveArtifacts(reloaded, 's1')
  const shape = (d: typeof live) => d.versions.map((v) => [v.key, v.version, v.title, v.content])
  assert.deepEqual(shape(again), shape(live))
  assert.deepEqual(Object.keys(again.mentions), ['h_1', 'h_3'])
  // Deterministic for the same input.
  assert.deepEqual(deriveArtifacts(reloaded, 's1'), again)
})

test('fences: thresholds, file names from the info string, first line or the line above', () => {
  const two = '```python\na = 1\nb = 2\n```'
  assert.equal(deriveArtifacts([reply(two)], null).versions.length, 0, 'a 2-line fence stays inline')
  assert.equal(deriveArtifacts([reply(two)], null, { minLines: 2 }).versions.length, 1, 'minLines option')

  const cases: [string, string, string][] = [
    ['```python title="a.py"', 'a.py', 'python'],
    ["```js filename='app.js'", 'app.js', 'javascript'],
    ['```ts file=src/x.ts', 'src/x.ts', 'typescript'],
    ['```python b.py', 'b.py', 'python'],
    ['```c.sh', 'c.sh', 'bash'],
    ['```python:d.py', 'd.py', 'python'],
  ]
  for (const [open, key, lang] of cases) {
    const [v] = deriveArtifacts([reply(`${open}\n1\n2\n3\n\`\`\``)], null).versions
    assert.equal(v?.key, key, open)
    assert.equal(v?.language, lang, open)
    assert.equal(v?.title, key)
  }
  const [comment] = deriveArtifacts([reply('```\n# file: tools/run.py\nx = 1\ny = 2\n```')], null).versions
  assert.equal(comment.key, 'tools/run.py')
  assert.equal(comment.language, 'python')
  const [above] = deriveArtifacts([reply('Save this as `main.go`:\n\n```go\npackage main\n\nfunc main() {}\n```')], null).versions
  assert.equal(above.key, 'code:go:1', 'a sentence above is not a file name')
  const [bold] = deriveArtifacts([reply('**main.go**\n```go\npackage main\n\nfunc main() {}\n```')], null).versions
  assert.equal(bold.key, 'main.go')
  assert.equal(bold.language, 'go')
})

test('unnamed fences are numbered by kind per session; markdown fences are documents', () => {
  const block = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``
  const { versions } = deriveArtifacts(
    [
      reply(`${block('py', 'a\nb\nc')}\n\n${block('python', 'd\ne\nf')}`),
      reply(block('md', '# Release notes\n\n- one\n- two')),
      reply(block('', 'x\ny\nz')),
    ],
    's',
  )
  assert.deepEqual(
    versions.map((v) => [v.key, v.title, v.kind]),
    [
      ['code:python:1', 'Python code', 'code'],
      ['code:python:2', 'Python code', 'code'],
      ['markdown:1', 'Release notes', 'markdown'],
      ['code:text:1', 'Code snippet', 'code'],
    ],
  )
})

test('versions: same key later is v+1, identical content adds none, also within one reply', () => {
  const f = (body: string) => `\`\`\`python title="x.py"\n${body}\n\`\`\``
  const r1 = reply(f('a\nb\nc'))
  const r2 = reply(f('a\nb\nc'))
  const r3 = reply(`${f('a\nb\nd')}\n\nand again\n\n${f('a\nb\ne')}`)
  const { versions, mentions } = deriveArtifacts([r1, r2, r3], 's')
  assert.deepEqual(versions.map((v) => [v.version, v.messageId, v.content]), [
    [1, r1.id, 'a\nb\nc'],
    [2, r3.id, 'a\nb\nd'],
    [3, r3.id, 'a\nb\ne'],
  ])
  assert.deepEqual(mentions[r2.id].map((v) => v.version), [1], 'a repeat mentions the existing version')
  assert.deepEqual(mentions[r3.id].map((v) => v.version), [3], 'one mention per key: the last')
})

test('tables: 2+ rows, header signature keys, labels, continuation by columns', () => {
  const one = '| a | b |\n|---|---|\n| 1 | 2 |'
  assert.equal(deriveArtifacts([reply(one)], null).versions.length, 0)
  const two = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |'
  const [t] = deriveArtifacts([reply(two)], null).versions
  assert.equal(t.key, 'table:a|b', 'the key format the server tests use')
  assert.equal(t.title, 'a table')
  assert.equal(t.rows, 2)

  // A different table (other first column) is a new key; a narrower one continues.
  const other = '| name | b |\n|---|---|\n| x | 2 |\n| y | 4 |'
  const narrower = '| a |\n|---|\n| 1 |\n| 3 |'
  const { versions } = deriveArtifacts([reply(two), reply(other), reply(narrower)], null)
  assert.deepEqual(versions.map((v) => [v.key, v.version]), [
    ['table:a|b', 1],
    ['table:a|b', 2],
    ['table:name|b', 1],
  ])

  // Same label, different columns: still the same table.
  const relabel = deriveArtifacts([reply(`## Plan\n\n${two}`), reply(`## Plan\n\n${other}`)], null).versions
  assert.deepEqual(relabel.map((v) => [v.key, v.version, v.title]), [
    ['table:a|b', 1, 'Plan'],
    ['table:a|b', 2, 'Plan'],
  ])

  // Fenced tables are code, not tables.
  assert.equal(deriveArtifacts([reply('```\n| a | b |\n|---|---|\n| 1 | 2 |\n```')], null).versions[0].kind, 'code')
})

test('elements: images, files, pdf, video, code; keyed by name, else url', () => {
  const el = (data: Record<string, unknown>) => ({ type: 'data', name: 'element', data })
  const m: DeriveMessage = {
    id: 'm1',
    role: 'assistant',
    createdAt: T0,
    parts: [
      el({ type: 'image', url: '/files/chart.png', alt: 'Chart' }),
      el({ type: 'file', name: 'report.csv', url: '/files/r.csv', mime: 'text/csv' }),
      el({ type: 'pdf', url: 'https://example.com/doc%20one.pdf' }),
      el({ type: 'video', url: '/v.mp4', name: 'demo.mp4' }),
      el({ type: 'code', name: 'q.sql', content: 'select 1' }),
      el({ type: 'image' }),
    ],
  }
  const { versions } = deriveArtifacts([m], 's')
  assert.deepEqual(
    versions.map((v) => [v.key, v.kind, v.title, v.url ?? null, v.mimeType ?? null]),
    [
      ['url:/files/chart.png', 'image', 'Chart', '/files/chart.png', null],
      ['file:report.csv', 'file', 'report.csv', '/files/r.csv', 'text/csv'],
      ['url:https://example.com/doc%20one.pdf', 'pdf', 'doc one.pdf', 'https://example.com/doc%20one.pdf', null],
      ['file:demo.mp4', 'video', 'demo.mp4', '/v.mp4', null],
      ['file:q.sql', 'code', 'q.sql', null, null],
    ],
  )
  assert.equal(versions[4].language, 'sql')
  assert.equal(versions[4].content, 'select 1')
})

test('A2UI surfaces are not artifacts; a code block in the same chat still is', () => {
  const a2 = (surface: string, messages: unknown[]) => ({ type: 'data', name: 'a2ui', data: { surface_id: surface, messages } })
  const m1: DeriveMessage = {
    id: 'm1',
    role: 'assistant',
    createdAt: T0,
    parts: [
      a2('main', [{ beginRendering: {} }]),
      { type: 'text', text: '```python title="s.py"\nprint(1)\nprint(2)\nprint(3)\n```' },
    ],
  }
  const m2: DeriveMessage = {
    id: 'm2',
    role: 'assistant',
    createdAt: T0 + 1,
    parts: [{ type: 'tool-call', artifact: { a2ui: [{ dataModelUpdate: 2 }], surface_id: 'main' } }],
  }
  const { versions } = deriveArtifacts([m1, m2], 's')
  assert.deepEqual(versions.map((v) => v.kind), ['code'])
  assert.equal(versions[0].key, 's.py')
})

test('streaming: an unclosed fence still counts and grows in place', () => {
  const partial = reply('```python title="s.py"\na\nb\nc', T0, { completedAt: undefined })
  const [v] = deriveArtifacts([partial], 's').versions
  assert.equal(v.key, 's.py')
  assert.equal(v.content, 'a\nb\nc')
  assert.equal(v.updatedAt, T0)
  const [blocks] = [scanMarkdown('```py\nx\n')]
  assert.equal(blocks[0].type === 'fence' && blocks[0].closed, false)
})

test('reasoning and indented fences', () => {
  const m: DeriveMessage = {
    id: 'm',
    role: 'assistant',
    createdAt: T0,
    parts: [{ type: 'reasoning' }, { type: 'text', text: '1. Step\n   ```bash\n   a\n   b\n   c\n   ```' }],
  }
  const [v] = deriveArtifacts([m], null).versions
  assert.equal(v.content, 'a\nb\nc', 'list indentation stripped')
  assert.equal(v.language, 'bash')
})

test('helpers: splitRow, parseInfo, plainText, languageName, parseTable, CSV, isLarge', () => {
  assert.deepEqual(splitRow('| a | `x|y` | b\\|c |'), ['a', '`x|y`', 'b|c'])
  assert.deepEqual(parseInfo('python {title="a b.py"}'), { language: 'python', filename: 'a b.py' })
  assert.deepEqual(parseInfo('1.2.3'), { language: '1.2.3', filename: undefined })
  assert.equal(plainText('**bold** and `code` and [link](x)'), 'bold and code and link')
  assert.equal(languageName('sh'), 'Shell')
  assert.equal(languageName('elixir'), 'Elixir')
  const { header, rows } = parseTable(TABLE_V2.split('\n\n')[1])
  assert.deepEqual(header, ['Algorithm', 'Average', 'Worst', 'Stable'])
  assert.equal(rows.length, 3)
  assert.equal(tableToCsv('| a | b |\n|---|---|\n| 1, 2 | "q" |'), 'a,b\r\n"1, 2","""q"""\r\n')
  assert.equal(isLarge({ kind: 'table', rows: 6 }), true)
  assert.equal(isLarge({ kind: 'table', rows: 5 }), false)
  assert.equal(isLarge({ kind: 'code', lines: 12 }), true)
  assert.equal(isLarge({ kind: 'image' }), false)
})

test('keys stay within the server\'s MAX_KEY: a wide table, a long URL, stable and distinct', () => {
  const cols = Array.from({ length: 40 }, (_, i) => `Column number ${i} 😀`)
  const tableOf = (h: string[]) => `| ${h.join(' | ')} |\n|${h.map(() => '---').join('|')}|\n| ${h.map((_, i) => i).join(' | ')} |\n| ${h.map((_, i) => i + 1).join(' | ')} |`
  const wide = (extra: string) => tableOf([...cols, extra])
  const m = (id: string, text: string): DeriveMessage => ({ id, role: 'assistant', createdAt: T0, parts: [{ type: 'text', text }] })
  const a = deriveArtifacts([m('m1', wide('A'))], 's').versions[0]
  const b = deriveArtifacts([m('m1', wide('B'))], 's').versions[0]
  assert.equal(Array.from(a.key).length, MAX_KEY)
  assert.ok(a.key.startsWith('table:column number 0'))
  assert.notEqual(a.key, b.key, 'distinct signatures stay distinct')
  assert.equal(deriveArtifacts([m('m9', wide('A'))], 's').versions[0].key, a.key, 'stable across derivations')
  assert.doesNotThrow(() => encodeURIComponent(a.key))
  const url = `https://example.com/${'x'.repeat(400)}.png`
  const img = deriveArtifacts([{ id: 'm2', role: 'assistant', createdAt: T0, parts: [{ type: 'data', name: 'element', data: { type: 'image', url } }] }], 's').versions[0]
  assert.ok(Array.from(img.key).length <= MAX_KEY)
  assert.equal(img.url, url, 'only the key is shortened')
  assert.equal(boundKey('short'), 'short')
  // The same table widened in a later reply is still one artifact with two versions.
  const two = deriveArtifacts([m('m1', tableOf(cols)), m('m3', wide('A'))], 's')
  assert.deepEqual(two.versions.map((v) => v.version), [1, 2])
  assert.equal(new Set(two.versions.map((v) => v.key)).size, 1)
})

test('a whiteboard or sheet fence is its own artifact, even when it is short', () => {
  const board = '```whiteboard id=wb_1\n{"id":"wb_1","title":"Retro","items":[]}\n```'
  const sheet = '```sheet id=sh_1\n{"id":"sh_1","title":"Budget","tabs":[]}\n```'
  const m = (id: string, text: string): DeriveMessage => ({ id, role: 'assistant', createdAt: T0, parts: [{ type: 'text', text }] })
  const { versions } = deriveArtifacts([m('b', board), m('s', sheet)], 's')
  assert.deepEqual(
    versions.map((v) => [v.kind, v.key, v.title]),
    [
      ['whiteboard', 'whiteboard:wb_1', 'Retro'],
      ['sheet', 'sheet:sh_1', 'Budget'],
    ],
  )
})
