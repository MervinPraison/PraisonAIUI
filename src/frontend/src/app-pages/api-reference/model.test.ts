// The API Reference page's logic (app-pages/api-reference/model.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { curlCommand, fillPath, groupOps, initialBody, initialOp, matches, operations, prettyBody, queryString, type OpenApiDoc } from './model'

const DOC: OpenApiDoc = {
  tags: [{ name: 'core', description: 'Core' }, { name: 'api', description: 'OpenAI' }, { name: 'empty' }],
  paths: {
    '/api/health': { get: { operationId: 'get_api_health', summary: 'Health', tags: ['core'], security: [] } },
    '/v1/models/{model_id}': {
      get: { operationId: 'get_model', summary: 'Get model info', tags: ['api'], parameters: [{ name: 'model_id', in: 'path', required: true }] },
    },
    '/v1/chat/completions': {
      post: {
        operationId: 'post_chat', summary: 'Chat completions', tags: ['api'],
        requestBody: { content: { 'application/json': { example: { messages: [{ role: 'user', content: 'Hi' }] } } } },
      },
    },
    '/sessions/{id}': { patch: { operationId: 'patch_session', summary: 'Rename', tags: ['plugin-x'] } },
  },
}

test('api-reference: flattens the document and groups by tag in its order', () => {
  const ops = operations(DOC)
  assert.deepEqual(ops.map((o) => o.id), ['get_api_health', 'get_model', 'post_chat', 'patch_session'])
  assert.equal(ops[0].isPublic, true)
  assert.equal(ops[1].isPublic, false)
  assert.deepEqual(ops[1].params.map((p) => p.name), ['model_id'])
  // Empty tags drop out; an undeclared tag joins at the end.
  assert.deepEqual(groupOps(DOC, ops).map((g) => [g.tag, g.ops.length]), [['core', 1], ['api', 2], ['plugin-x', 1]])
})

test('api-reference: search matches every word in method, path, summary or tag', () => {
  const ops = operations(DOC)
  assert.deepEqual(ops.filter((o) => matches(o, 'POST chat')).map((o) => o.id), ['post_chat'])
  assert.deepEqual(ops.filter((o) => matches(o, 'api models')).map((o) => o.id), ['get_model'])
  assert.equal(ops.filter((o) => matches(o, 'nothing-like-this')).length, 0)
})

test('api-reference: builds the request path, query and body', () => {
  assert.equal(fillPath('/v1/models/{model_id}', {}), null)
  assert.equal(fillPath('/v1/models/{model_id}', { model_id: 'a b/c' }), '/v1/models/a%20b%2Fc')
  assert.equal(queryString(' ?limit=5 '), '?limit=5')
  assert.equal(queryString(''), '')
  const [health, model, chat, patch] = operations(DOC)
  assert.equal(initialBody(health), '')
  assert.equal(initialBody(model), '')
  assert.deepEqual(JSON.parse(initialBody(chat)), { messages: [{ role: 'user', content: 'Hi' }] })
  assert.equal(initialBody(patch), '{}')
})

test('api-reference: cURL never carries a credential, and quotes are escaped', () => {
  const cmd = curlCommand('post', "http://h/x?q='1'", '{"a":"it\'s"}', false)
  assert.match(cmd, /^curl -X POST 'http:\/\/h\/x\?q='\\''1'\\'''/)
  assert.match(cmd, /Bearer \$AIUI_TOKEN/)
  assert.match(cmd, /-d '\{"a":"it'\\''s"\}'/)
  assert.doesNotMatch(curlCommand('get', 'http://h/api/health', '', true), /Authorization|-d /)
})

test('api-reference: pretty JSON, plain text kept, ?op= deep link', () => {
  assert.equal(prettyBody('{"a":1}'), '{\n  "a": 1\n}')
  assert.equal(prettyBody('not json'), 'not json')
  const ops = operations(DOC)
  assert.equal(initialOp('?op=post_chat', ops), 'post_chat')
  assert.equal(initialOp('?op=missing', ops), null)
})
