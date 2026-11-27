import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MessageProcessor } from '@a2ui/web_core/v0_9'
import { basicCatalog } from '@a2ui/react/v0_9'
import { BASIC_CATALOG_ID, toOfficialMessages } from './a2ui-official'
import { a2uiToComponents } from './a2uiToComponents'

const loose = [
  { createSurface: { surfaceId: 'main', catalogId: 'basic' } },
  {
    updateComponents: {
      components: [
        { component: 'Text', text: { literal: 'Hello' } },
        { component: 'Card', children: [{ component: 'TextField', label: 'Name' }] },
        { component: 'Button', text: { literal: 'Go' }, action: { name: 'go' } },
      ],
    },
  },
]

test('loose canvas messages become the official basic catalog with synthesized root', () => {
  const messages = toOfficialMessages(loose)
  assert.ok(messages)
  const create = messages[0].createSurface as { catalogId: string }
  assert.equal(create.catalogId, BASIC_CATALOG_ID)

  const processor = new MessageProcessor([basicCatalog])
  processor.processMessages(messages)
  const surface = processor.model.getSurface('main')
  assert.ok(surface)
  const found = new Set<string>()
  let hasRoot = false
  for (const [id, comp] of surface.componentsModel.entries) {
    if (id === 'root') hasRoot = true
    if (comp?.type) found.add(comp.type)
  }
  assert.ok(hasRoot, 'synthesized root component is present')
  assert.ok(found.has('Text'), [...found].join(','))
  assert.ok(found.has('TextField'), [...found].join(','))
  assert.ok(found.has('Button'), [...found].join(','))
  assert.ok(found.has('Card'), [...found].join(','))
})

test('updateDataModel and {path} bindings are preserved intact and populate dataModel', () => {
  const msgs = toOfficialMessages([
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: 'bound',
        catalogId: 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
        theme: { primaryColor: '#2563eb' },
        sendDataModel: true,
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: 'bound',
        components: [
          { id: 'root', component: 'Column', children: ['greeting'] },
          { id: 'greeting', component: 'Text', text: { path: '/title' }, variant: 'h1' },
        ],
      },
    },
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId: 'bound',
        path: '/',
        value: { title: 'Hello Bound World' },
      },
    },
  ])
  assert.ok(msgs)
  assert.equal(msgs.length, 3)
  const updateComps = (msgs[1].updateComponents as { components: Record<string, unknown>[] }).components
  assert.deepEqual(updateComps[1].text, { path: '/title' })

  const processor = new MessageProcessor([basicCatalog])
  processor.processMessages(msgs)
  const surface = processor.model.getSurface('bound')
  assert.ok(surface)
  assert.equal(surface.dataModel.get('/title'), 'Hello Bound World')
})

test('v0.8 messages (beginRendering, surfaceUpdate, dataModelUpdate) upgrade cleanly to v0.9', () => {
  const v08 = [
    {
      surfaceUpdate: {
        surfaceId: 'legacy',
        components: [
          {
            id: 'main-box',
            component: { Column: { children: { explicitList: ['hdr'] }, distribution: 'start' } },
          },
          {
            id: 'hdr',
            component: { Text: { text: { path: '/heading' }, usageHint: 'h2' } },
          },
        ],
      },
    },
    {
      dataModelUpdate: {
        surfaceId: 'legacy',
        path: '/',
        contents: [{ key: 'heading', valueString: 'From v0.8' }],
      },
    },
    {
      beginRendering: {
        surfaceId: 'legacy',
        root: 'main-box',
        catalogId: 'https://a2ui.org/specification/v0_8/standard_catalog_definition.json',
      },
    },
  ]
  const msgs = toOfficialMessages(v08)
  assert.ok(msgs)
  assert.equal(msgs[0].createSurface !== undefined, true)
  const processor = new MessageProcessor([basicCatalog])
  processor.processMessages(msgs)
  const surface = processor.model.getSurface('legacy')
  assert.ok(surface)
  assert.equal(surface.dataModel.get('/heading'), 'From v0.8')
})

test('deleteSurface is preserved and a2uiToComponents yields to official renderer on data bindings', () => {
  const del = toOfficialMessages([{ deleteSurface: { surfaceId: 'gone' } }])
  assert.ok(del)
  assert.deepEqual(del[0].deleteSurface, { surfaceId: 'gone' })

  assert.equal(
    a2uiToComponents([
      { updateComponents: { components: [{ id: 't', component: 'Text', text: { path: '/x' } }] } },
      { updateDataModel: { path: '/', value: { x: 'hi' } } },
    ]),
    null,
  )
})

test('a foreign catalog is left to the plain mapper', () => {
  const messages = toOfficialMessages([
    { createSurface: { surfaceId: 'main', catalogId: 'https://example.com/shop.json' } },
    { updateComponents: { components: [{ component: 'Text', text: 'Hi' }] } },
  ])
  assert.equal(messages, null)
})
