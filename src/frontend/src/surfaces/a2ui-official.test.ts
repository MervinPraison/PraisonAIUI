import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MessageProcessor } from '@a2ui/web_core/v0_9'
import { basicCatalog } from '@a2ui/react/v0_9'
import { BASIC_CATALOG_ID, toOfficialMessages } from './a2ui-official'

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

test('loose canvas messages become the official basic catalog', () => {
  const messages = toOfficialMessages(loose)
  assert.ok(messages)
  const create = messages[0].createSurface as { catalogId: string }
  assert.equal(create.catalogId, BASIC_CATALOG_ID)

  const processor = new MessageProcessor([basicCatalog])
  processor.processMessages(messages)
  const surface = processor.model.getSurface('main')
  assert.ok(surface)
  const found = new Set<string>()
  for (const [, comp] of surface.componentsModel.entries) {
    if (comp?.type) found.add(comp.type)
  }
  assert.ok(found.has('Text'), [...found].join(','))
  assert.ok(found.has('TextField'), [...found].join(','))
  assert.ok(found.has('Button'), [...found].join(','))
  assert.ok(found.has('Card'), [...found].join(','))
})

test('a foreign catalog is left to the plain mapper', () => {
  const messages = toOfficialMessages([
    { createSurface: { surfaceId: 'main', catalogId: 'https://example.com/shop.json' } },
    { updateComponents: { components: [{ component: 'Text', text: 'Hi' }] } },
  ])
  assert.equal(messages, null)
})
