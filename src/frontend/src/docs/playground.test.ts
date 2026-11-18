// Try it request building (playground.ts): servers and variables, parameters,
// the body, the curl command and the fetch arguments.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bodyProblem, buildRequest, byteSize, curl, fetchArgs, initialValues, initialVariables, missing, prettyBody, serverUrl, type Operation } from './playground'

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
