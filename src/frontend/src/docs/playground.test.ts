// Try it request building (playground.ts): servers and variables, parameters,
// the body, the curl command and the fetch arguments.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    authHook, authInputs, bodyProblem, buildRequest, byteSize, curl, encodeFile, fetchArgs, initialAuth, initialValues, initialVariables, isStream, loadAuth,
    missing, prettyBody, readBody, saveAuth, serverUrl, sseEvents, withField, type AuthScheme, type Operation,
} from './playground'

const op: Operation = {
    method: 'POST',
    path: '/pets/{petId}',
    servers: [{ url: 'https://{env}.example.com/v1/', variables: { env: { default: 'api', enum: ['api', 'sandbox'] } } }, { url: '/v2' }],
    params: [
        { name: 'petId', in: 'path', required: true, example: '7' },
        { name: 'tags', in: 'query', array: true, example: 'a, b' },
        { name: 'verbose', in: 'query', enum: ['true', 'false'] },
        { name: 'X-Trace', in: 'header', example: 't-1' },
        { name: 'session', in: 'cookie', example: 's 1' },
    ],
    body: { type: 'application/json', example: '{"name": "Rex"}', required: true },
}
const form: Operation = { method: 'POST', path: '/up', servers: [], params: [], body: { type: 'multipart/form-data', example: '' } }

test('servers: variables filled, trailing slash dropped, a relative URL joins the docs site', () => {
    assert.equal(serverUrl(op.servers[0], initialVariables(op.servers[0]), 'https://docs.test'), 'https://api.example.com/v1')
    assert.equal(serverUrl(op.servers[0], { env: 'sandbox' }, 'https://docs.test'), 'https://sandbox.example.com/v1')
    assert.equal(serverUrl(op.servers[1], {}, 'https://docs.test'), 'https://docs.test/v2')
    assert.equal(serverUrl(undefined, {}, 'http://localhost:8000'), 'http://localhost:8000')
})

test('inputs start with the examples unless prefill is off; empty required ones are named', () => {
    assert.equal(initialValues(op)['path:petId'], '7')
    assert.equal(initialValues({ ...op, prefill: false })['path:petId'], '')
    assert.deepEqual(missing(op, { 'path:petId': ' ' }), ['petId'])
    assert.deepEqual(missing(op, initialValues(op)), [])
})

test('buildRequest and curl: encoded path, repeated array values, headers, cookies, body; hooks run last', () => {
    const auth = (d: ReturnType<typeof buildRequest>) => ({ ...d, headers: [...d.headers, ['Authorization', 'Bearer t'] as [string, string]] })
    const d = buildRequest(op, 'https://x.test', { ...initialValues(op), 'path:petId': 'a/b' }, `{"q": "it's"}`, [auth])
    assert.equal(curl(d), [
        'curl --request POST', "--url 'https://x.test/pets/a%2Fb?tags=a&tags=b'", "--header 'X-Trace: t-1'", "--header 'Cookie: session=s 1'",
        "--header 'Content-Type: application/json'", "--header 'Authorization: Bearer t'", `--data '{"q": "it'\\''s"}'`,
    ].join(' \\\n  '))
    assert.deepEqual(fetchArgs(d)[1].headers, [['X-Trace', 't-1'], ['Content-Type', 'application/json'], ['Authorization', 'Bearer t']])
    const bare = buildRequest(op, '', {}, '  ') // an empty path value keeps its placeholder; an empty body is not sent
    assert.deepEqual([bare.url, bare.body], ['/pets/{petId}', undefined])
})

test('multipart bodies are JSON fields sent as FormData; a body that cannot be sent is named', () => {
    const d = buildRequest(form, 'https://x.test', {}, '{"name": "a", "n": 2}')
    assert.deepEqual(d.headers, [])
    assert.match(curl(d), /--form 'name=a' \\\n {2}--form 'n=2'/)
    assert.equal((fetchArgs(d)[1].body as FormData).get('n'), '2')
    assert.equal(bodyProblem(buildRequest(op, '', {}, '{nope')), 'The body is not valid JSON.')
    assert.equal(bodyProblem(buildRequest(form, '', {}, 'x')), 'Write the form fields as a JSON object.')
    assert.equal(bodyProblem(d), '')
})

test('responses: JSON pretty-printed, other text as sent; sizes', () => {
    assert.equal(prettyBody('{"a":1}', 'application/json'), '{\n  "a": 1\n}')
    assert.equal(prettyBody('<p>hi</p>', 'text/html'), '<p>hi</p>')
    assert.equal(prettyBody('{bad', 'application/json'), '{bad')
    assert.deepEqual([byteSize(830), byteSize(1234), byteSize(2_500_000)], ['830 B', '1.2 kB', '2.5 MB'])
})

const schemes: AuthScheme[] = [
    { id: 'key', type: 'apiKey', in: 'header', name: 'X-Key' },
    { id: 'q', type: 'apiKey', in: 'query', name: 'api key' },
    { id: 'sid', type: 'apiKey', in: 'cookie', name: 'sid' },
    { id: 'token', type: 'oauth2', scopes: ['read'] },
]

test('auth: API key header, query and cookie, bearer tokens; masked for the curl command', () => {
    const values = { key: 'k1', q: 'a&b', sid: 's9', token: 'Bearer t-1' }
    const d = buildRequest(op, 'https://x.test', initialValues(op), '', [authHook(schemes, values)])
    assert.equal(d.url, 'https://x.test/pets/7?tags=a&tags=b&api%20key=a%26b')
    assert.deepEqual(d.headers, [['X-Trace', 't-1'], ['Cookie', 'session=s 1; sid=s9'], ['X-Key', 'k1'], ['Authorization', 'Bearer t-1']])
    const shown = curl(buildRequest(op, 'https://x.test', initialValues(op), '', [authHook(schemes, values, true)]))
    assert.ok(!/k1|s9|t-1'|a%26b/.test(shown.replace("X-Trace: t-1", '')), shown)
    assert.match(shown, /--header 'Authorization: Bearer \*{8}'/)
    const empty = buildRequest(op, '', {}, '', [authHook(schemes, {})]) // nothing typed: nothing added
    assert.deepEqual(empty.headers, [])
})

test('auth: basic encodes username:password (UTF-8); other http schemes keep their name; inputs and storage', () => {
    const basic: AuthScheme = { id: 'b', type: 'http', scheme: 'basic' }
    assert.deepEqual(authInputs(basic), [['b:username', 'Username'], ['b:password', 'Password']])
    assert.deepEqual(authInputs(schemes[0]), [['key', 'X-Key']])
    const d = buildRequest(form, '', {}, '', [authHook([basic, { id: 'd', type: 'http', scheme: 'Digest' }], { 'b:username': 'ä', 'b:password': 'p', d: 'x' })])
    assert.deepEqual(d.headers, [['Authorization', 'Basic w6Q6cA=='], ['Authorization', 'Digest x']])
    const auth = { ...op, auth: [[{ ...schemes[0], default: 'dflt' }], []] }
    assert.deepEqual(initialAuth(auth, {}), { key: 'dflt' })
    assert.deepEqual(initialAuth(auth, { key: 'typed' }), { key: 'typed' })
    const store = new Map<string, string>()
    const g = globalThis as { window?: unknown }
    g.window = { sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } }
    saveAuth('/docs', { key: 'k', empty: '' })
    assert.deepEqual([...store.keys()], ['aiui-try-auth:/docs'])
    assert.deepEqual(loadAuth('/docs'), { key: 'k' })
    assert.deepEqual(loadAuth('/other'), {})
    delete g.window
    assert.deepEqual(loadAuth('/docs'), {}) // no storage: nothing, no error
})

test('files: multipart parts replace their JSON field, a binary body is the file, base64 fields', async () => {
    const photo = new File(['png'], 'cat.png', { type: 'image/png' })
    const d = buildRequest(form, 'https://x.test', {}, '{"title": "a", "photo": "<binary>"}', [], { photo })
    assert.match(curl(d), /--form 'title=a' \\\n {2}--form 'photo=@cat.png'$/)
    const sent = fetchArgs(d)[1].body as FormData
    assert.equal((sent.get('photo') as File).name, 'cat.png')
    assert.deepEqual(buildRequest(form, '', {}, '', [], { photo }).body, '{}') // files alone still send
    const raw: Operation = { method: 'PUT', path: '/p', servers: [], params: [], body: { type: 'image/png', example: '', file: true } }
    const r = buildRequest(raw, 'https://x.test', {}, 'ignored', [], { '': photo })
    assert.match(curl(r), /--header 'Content-Type: image\/png' \\\n {2}--data-binary '@cat.png'$/)
    assert.equal(fetchArgs(r)[1].body, photo)
    assert.equal(buildRequest(raw, '', {}, '').body, undefined) // no file chosen: no body
    assert.equal(await encodeFile(new Blob([new Uint8Array([251, 255])])), '+/8=')
    assert.equal(await encodeFile(new Blob([new Uint8Array([251, 255])]), 'base64url'), '-_8')
    assert.equal(withField('{"name": "a"}', 'photo', 'AA=='), '{\n  "name": "a",\n  "photo": "AA=="\n}')
    assert.equal(withField('nope', 'photo', 'AA=='), '{\n  "photo": "AA=="\n}')
})

test('streams: read as they arrive with a cap; server-sent events parsed', async () => {
    assert.ok(isStream('text/event-stream; charset=utf-8') && isStream('application/x-ndjson') && !isStream('application/json'))
    const chunks = ['data: {"a"', ':1}\n\nevent: done\nid: 2\ndata: x\ndata: y\n\n: ping\n\n']
    const seen: number[] = []
    const res = new Response(new ReadableStream({ start(c) { for (const t of chunks) c.enqueue(new TextEncoder().encode(t)); c.close() } }))
    let text = ''
    assert.equal(await readBody(res, (t, n) => { text = t; seen.push(n) }), 'done')
    assert.deepEqual(seen.slice(0, 2), [10, 10 + new TextEncoder().encode(chunks[1]).length]) // once per chunk
    assert.deepEqual(sseEvents(text), [{ data: '{"a":1}' }, { event: 'done', id: '2', data: 'x\ny' }])
    const big = new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(10)) } }))
    assert.equal(await readBody(big, () => {}, 25), 'capped')
    const broken = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([104])); c.error(new Error('reset')) } }))
    await assert.rejects(readBody(broken, () => {}))
})
