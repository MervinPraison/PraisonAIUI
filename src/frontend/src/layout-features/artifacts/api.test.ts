// The artifacts client against the server feature (features/artifacts.py,
// Track D): URLs, methods and bodies, the record checks, and a source-level
// contract check that the kinds, routes and limits match the Python module.
//
// The runner starts node with cwd = src/frontend (scripts/run-tests.mjs).
import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ShellManifest } from '@/sdk/manifest'
import {
  ARTIFACT_KINDS,
  artifactsServerEnabled,
  codeLanguages,
  codeRunAvailable,
  deleteArtifacts,
  fetchArtifactIndex,
  fetchSessionArtifacts,
  MAX_CONTENT_BYTES,
  putArtifact,
  putBody,
  resetApiCachesForTests,
  runCode,
} from './api'

const g = globalThis as unknown as Record<string, unknown>
if (typeof g.window === 'undefined') g.window = globalThis
g.location = { href: 'http://app.test/chat', origin: 'http://app.test', pathname: '/chat' }

interface Call {
  url: string
  method: string
  body: unknown
}

function stubFetch(respond: (url: string, method: string) => Response): Call[] {
  const calls: Call[] = []
  g.fetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    calls.push({ url, method, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body })
    return respond(url, method)
  }
  return calls
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => resetApiCachesForTests())

const manifest = (plugins: ShellManifest['plugins']): ShellManifest =>
  ({ sdk: 1, version: '0', style: 'app', site: {}, layout: {}, pages: [], blocks: [], toolRenderers: [], plugins, legacy: { customJs: null, viewsBase: '' } }) as ShellManifest

test('record checks: builtin.artifacts and builtin.code-studio must be ok', () => {
  assert.equal(artifactsServerEnabled(null), false, 'no manifest (dev, tests): client only')
  assert.equal(artifactsServerEnabled(manifest([{ name: 'builtin.artifacts', status: 'disabled' }])), false)
  assert.equal(artifactsServerEnabled(manifest([{ name: 'builtin.artifacts', status: 'ok' }])), true)
  assert.equal(codeRunAvailable(manifest([{ name: 'builtin.artifacts', status: 'ok' }])), false)
  assert.equal(codeRunAvailable(manifest([{ name: 'builtin.code-studio', status: 'ok' }])), true)
})

test('index, session, put, delete: URLs, methods, bodies', async () => {
  const calls = stubFetch((url, method) => {
    if (method === 'PUT') return json({ artifact: { key: 'k', kind: 'code', version: 3 } })
    if (method === 'DELETE') return json({ deleted: 2 })
    if (url.startsWith('/api/artifacts?') || url === '/api/artifacts') return json({ artifacts: [{ key: 'a' }], count: 4, sessions: 2 })
    return json({ sessionId: 's', artifacts: [{ key: 'b' }] })
  })
  assert.deepEqual(await fetchArtifactIndex(), { artifacts: [{ key: 'a' }], count: 4, sessions: 2 })
  await fetchArtifactIndex({ sessionId: 's 1', limit: 20 })
  assert.deepEqual(await fetchSessionArtifacts('s/1'), [{ key: 'b' }])
  const put = await putArtifact('s1', 'src/x.py', { kind: 'code', edited: true, content: 'x' })
  assert.equal(put.version, 3)
  assert.equal(await deleteArtifacts('s1', 'table:a|b', 2), 2)
  await deleteArtifacts('s1')
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    [
      'GET /api/artifacts',
      'GET /api/artifacts?session_id=s+1&limit=20',
      'GET /api/artifacts/s%2F1',
      'PUT /api/artifacts/s1/src%2Fx.py',
      'DELETE /api/artifacts/s1/table%3Aa%7Cb?version=2',
      'DELETE /api/artifacts/s1',
    ],
  )
  assert.deepEqual(calls[3].body, { kind: 'code', edited: true, content: 'x' })
})

test('putBody: derived versions go without content, user versions with it; limits respected', () => {
  const derived = putBody({ kind: 'table', title: 'T', version: 2, messageId: 'm', content: '| a |', language: 'x'.repeat(65) }, false)
  assert.deepEqual(derived, { kind: 'table', title: 'T', messageId: 'm', version: 2 })
  const edited = putBody({ kind: 'code', title: 't', version: 4, edited: true, content: 'print(1)' }, true)
  assert.deepEqual(edited, { kind: 'code', title: 't', edited: true, content: 'print(1)' }, 'an edit takes the next number on the server')
  const big = putBody({ kind: 'code', edited: true, content: 'x'.repeat(MAX_CONTENT_BYTES + 1) }, true)
  assert.equal(big.content, undefined)
  assert.equal(putBody({ kind: 'image', url: `data:image/png;base64,${'A'.repeat(5000)}` }, false).url, undefined)
})

test('runCode: success, denial and failure all resolve with a status', async () => {
  let reply: Response = json({ status: 'success', output: '[1, 2]\n', error: '' })
  const calls = stubFetch(() => reply)
  const ok = await runCode('print(1)', 'python')
  assert.equal(ok.status, 'success')
  assert.equal(ok.output, '[1, 2]\n')
  assert.equal(ok.error, undefined)
  assert.deepEqual(calls[0], { url: '/api/code/execute', method: 'POST', body: { code: 'print(1)', language: 'python' } })
  reply = json({ status: 'denied', error: 'Not run: denied' }, 403)
  assert.deepEqual({ ...(await runCode('x', 'python')), durationMs: 0 }, { status: 'denied', error: 'Not run: denied', durationMs: 0 })
  g.fetch = async () => {
    throw new TypeError('Failed to fetch')
  }
  const down = await runCode('x', 'python')
  assert.equal(down.status, 'error')
  assert.match(down.error ?? '', /Failed to fetch/)
})

test('codeLanguages: cached ids; a failure is [] and retried next time', async () => {
  let n = 0
  stubFetch(() => (++n === 1 ? json({ error: 'x' }, 500) : json({ languages: [{ id: 'python' }, { id: 'bash' }, {}] })))
  assert.deepEqual(await codeLanguages(), [])
  assert.deepEqual(await codeLanguages(), ['python', 'bash'])
  assert.deepEqual(await codeLanguages(), ['python', 'bash'])
  assert.equal(n, 2)
})

test('contract: kinds, routes and limits match features/artifacts.py', () => {
  const py = readFileSync(path.resolve(process.cwd(), '../praisonaiui/features/artifacts.py'), 'utf8')
  const kinds = /^KINDS = \(([^)]*)\)/m.exec(py)?.[1]
  assert.ok(kinds, 'KINDS in artifacts.py')
  assert.deepEqual([...kinds.matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]), [...ARTIFACT_KINDS])
  const routes = [...py.matchAll(/Route\("([^"]+)", self\.\w+, methods=\[([^\]]+)\]\)/g)].map((m) => `${m[2].replace(/"/g, '')} ${m[1]}`)
  assert.deepEqual(routes, [
    'GET /api/artifacts',
    'GET, DELETE /api/artifacts/{session_id}',
    'PUT, DELETE /api/artifacts/{session_id}/{key:path}',
  ])
  assert.match(py, /^MAX_CONTENT = 512 \* 1024$/m)
  assert.match(py, /_TEXT_LIMITS = \{"messageId": 200, "language": 64, "mimeType": 128, "url": 4096\}/)
  assert.match(py, /^MAX_TITLE = 300$/m)
  // An edit (or no version) takes the next number; a version with a number replaces it.
  assert.match(py, /if version is None or item\["edited"\]:/)
  const code = readFileSync(path.resolve(process.cwd(), '../praisonaiui/features/code_execution.py'), 'utf8')
  assert.match(code, /Route\("\/api\/code\/execute", self\._execute, methods=\["POST"\]\)/)
  assert.match(code, /body\.get\("code", ""\)/)
  assert.match(code, /body\.get\("language", "python"\)/)
})
