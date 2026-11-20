/** Loose Praison canvas messages → A2UI v0.9 basic-catalog messages. */

export const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json'

const LOOSE_CATALOGS = new Set(['basic', 'https://a2ui.org/specification/v0_9/basic_catalog.json'])

type Msg = Record<string, unknown>

function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>
    if (typeof node.literal === 'string') return node.literal
    if (typeof node.path === 'string') return node.path
  }
  return undefined
}

function actionOf(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const action = value as Record<string, unknown>
  if (action.event && typeof action.event === 'object') return action
  const name = typeof action.name === 'string' ? action.name : typeof action.type === 'string' ? action.type : ''
  if (!name) return undefined
  const context = action.payload && typeof action.payload === 'object' ? action.payload : {}
  return { event: { name, context } }
}

function flatten(comp: Record<string, unknown>, out: Record<string, unknown>[], prefix: string): string {
  const id = typeof comp.id === 'string' && comp.id ? comp.id : prefix
  const rawChildren = (comp.children ?? comp.childComponents) as unknown
  let children: string[] | undefined
  if (Array.isArray(rawChildren)) {
    children = rawChildren.map((child, index) => {
      if (typeof child === 'string') return child
      if (child && typeof child === 'object') {
        return flatten(child as Record<string, unknown>, out, `${id}-${index}`)
      }
      return `${id}-${index}`
    })
  }

  const next: Record<string, unknown> = { ...comp, id }
  delete next.childComponents
  if (children) next.children = children

  const text = textOf(next.text)
  if (text !== undefined) next.text = text
  const label = textOf(next.label)
  if (label !== undefined) next.label = label

  const action = actionOf(next.action)
  if (action) next.action = action
  else delete next.action

  if (next.component === 'Button' && !next.child && text) {
    const labelId = `${id}-label`
    out.push({ id: labelId, component: 'Text', text })
    next.child = labelId
    delete next.text
  }

  out.push(next)
  return id
}

function componentsOf(update: Record<string, unknown>): Record<string, unknown>[] {
  const raw = (update.components ?? update.componentList) as unknown
  if (!Array.isArray(raw)) return []
  const flat: Record<string, unknown>[] = []
  raw.forEach((comp, index) => {
    if (comp && typeof comp === 'object') flatten(comp as Record<string, unknown>, flat, `c${index}`)
  })
  return flat
}

/** Return spec messages, or null when nothing here can be drawn by the basic catalog. */
export function toOfficialMessages(messages: unknown, surfaceId = 'main'): Msg[] | null {
  if (!Array.isArray(messages) || messages.length === 0) return null
  const out: Msg[] = []
  let sid = surfaceId
  for (const item of messages) {
    if (!item || typeof item !== 'object') continue
    const msg = item as Msg
    if (msg.createSurface && typeof msg.createSurface === 'object') {
      const create = { ...(msg.createSurface as Msg) }
      sid = typeof create.surfaceId === 'string' ? create.surfaceId : sid
      const catalog = typeof create.catalogId === 'string' ? create.catalogId : 'basic'
      if (!LOOSE_CATALOGS.has(catalog)) return null
      out.push({
        version: 'v0.9',
        createSurface: { ...create, surfaceId: sid, catalogId: BASIC_CATALOG_ID },
      })
      continue
    }
    if (msg.updateComponents && typeof msg.updateComponents === 'object') {
      const update = msg.updateComponents as Msg
      const components = componentsOf(update)
      if (!components.length) continue
      const updateSid = typeof update.surfaceId === 'string' ? update.surfaceId : sid
      out.push({ version: 'v0.9', updateComponents: { surfaceId: updateSid, components } })
    }
  }
  if (!out.some((msg) => msg.createSurface)) {
    out.unshift({
      version: 'v0.9',
      createSurface: { surfaceId: sid, catalogId: BASIC_CATALOG_ID },
    })
  }
  return out.some((msg) => msg.updateComponents) ? out : null
}
