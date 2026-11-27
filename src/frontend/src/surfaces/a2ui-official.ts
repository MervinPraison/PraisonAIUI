/** Loose / v0.8 / v0.9 / v0.10 A2UI messages → official A2UI v0.9 basic-catalog messages. */

export const BASIC_CATALOG_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json'

const LOOSE_CATALOGS = new Set([
  'basic',
  BASIC_CATALOG_ID,
  'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json',
  'https://a2ui.org/specification/v0_10/catalogs/basic/catalog.json',
  'https://a2ui.org/specification/v0_8/standard_catalog_definition.json',
])

type Msg = Record<string, unknown>

function dynamicValueOf(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') return value
  const node = value as Record<string, unknown>
  // Preserve v0.9 data-binding paths and function calls intact so Generic Binder resolves them reactively.
  if (typeof node.path === 'string') return { path: node.path }
  if (typeof node.call === 'string') return node
  if ('literal' in node) return node.literal
  if ('literalString' in node) return node.literalString
  if ('literalNumber' in node) return node.literalNumber
  if ('literalBoolean' in node) return node.literalBoolean
  if ('literalArray' in node) return node.literalArray
  return value
}

function actionOf(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const action = value as Record<string, unknown>
  if (action.event && typeof action.event === 'object') return action
  if (action.functionCall && typeof action.functionCall === 'object') return action
  const name = typeof action.name === 'string' ? action.name : typeof action.type === 'string' ? action.type : ''
  if (!name) return undefined
  let context: Record<string, unknown> = {}
  if (Array.isArray(action.context)) {
    for (const entry of action.context) {
      if (entry && typeof entry === 'object' && 'key' in entry) {
        const rec = entry as Record<string, unknown>
        context[String(rec.key)] = dynamicValueOf(rec.value)
      }
    }
  } else if (action.context && typeof action.context === 'object') {
    context = action.context as Record<string, unknown>
  } else if (action.payload && typeof action.payload === 'object') {
    context = action.payload as Record<string, unknown>
  }
  return { event: { name, context } }
}

function convertV08Contents(contents: unknown): unknown {
  if (!Array.isArray(contents)) return contents
  const out: Record<string, unknown> = {}
  for (const item of contents) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    if (typeof rec.key !== 'string') continue
    if ('valueString' in rec) out[rec.key] = rec.valueString
    else if ('valueNumber' in rec) out[rec.key] = rec.valueNumber
    else if ('valueBoolean' in rec) out[rec.key] = rec.valueBoolean
    else if ('valueMap' in rec) out[rec.key] = convertV08Contents(rec.valueMap)
    else if ('value' in rec) out[rec.key] = rec.value
  }
  return out
}

function unwrapComponent(comp: Record<string, unknown>): Record<string, unknown> {
  // Handle v0.8 wrapper: { id, component: { Text: { text: ... } } }
  if (comp.component && typeof comp.component === 'object' && !Array.isArray(comp.component)) {
    const entries = Object.entries(comp.component as Record<string, unknown>)
    if (entries.length === 1) {
      const [typeName, rawProps] = entries[0]
      const props = rawProps && typeof rawProps === 'object' ? (rawProps as Record<string, unknown>) : {}
      return { id: comp.id, component: typeName, ...props }
    }
  }
  return comp
}

function flatten(comp: Record<string, unknown>, out: Record<string, unknown>[], prefix: string): string {
  const unwrapped = unwrapComponent(comp)
  const id = typeof unwrapped.id === 'string' && unwrapped.id ? unwrapped.id : prefix
  const rawChildren = (unwrapped.children ?? unwrapped.childComponents) as unknown

  let children: unknown = undefined
  if (Array.isArray(rawChildren)) {
    children = rawChildren.map((child, index) => {
      if (typeof child === 'string') return child
      if (child && typeof child === 'object') {
        return flatten(child as Record<string, unknown>, out, `${id}-${index}`)
      }
      return `${id}-${index}`
    })
  } else if (rawChildren && typeof rawChildren === 'object') {
    const rec = rawChildren as Record<string, unknown>
    if (Array.isArray(rec.explicitList)) {
      children = rec.explicitList
    } else if (rec.template && typeof rec.template === 'object') {
      const tpl = rec.template as Record<string, unknown>
      children = {
        componentId: String(tpl.componentId ?? ''),
        path: String(tpl.dataBinding ?? tpl.path ?? ''),
      }
    } else if (typeof rec.componentId === 'string' && typeof rec.path === 'string') {
      children = rec
    }
  }

  const next: Record<string, unknown> = { ...unwrapped, id }
  delete next.childComponents
  if (children !== undefined) next.children = children

  // v0.8 property renames -> v0.9
  if ('usageHint' in next && !('variant' in next)) {
    next.variant = next.usageHint
    delete next.usageHint
  }
  if ('distribution' in next && !('justify' in next)) {
    next.justify = next.distribution
    delete next.distribution
  }
  if ('alignment' in next && !('align' in next)) {
    next.align = next.alignment
    delete next.alignment
  }
  if (next.component === 'Button' && next.primary === true && !('variant' in next)) {
    next.variant = 'primary'
    delete next.primary
  }
  if (next.component === 'TextField' && 'text' in next && !('value' in next)) {
    next.value = next.text
    delete next.text
  }

  // Unwrap v0.8/loose literal wrappers while preserving { path } & { call } bindings.
  for (const key of ['text', 'label', 'url', 'value', 'name', 'title', 'caption', 'placeholder']) {
    if (key in next) {
      next[key] = dynamicValueOf(next[key])
    }
  }

  const action = actionOf(next.action)
  if (action) next.action = action
  else delete next.action

  if (next.component === 'Button' && !next.child && next.text !== undefined) {
    const labelId = `${id}-label`
    out.push({ id: labelId, component: 'Text', text: next.text })
    next.child = labelId
    delete next.text
  }

  out.push(next)
  return id
}

function collectReferencedIds(components: Record<string, unknown>[]): Set<string> {
  const refs = new Set<string>()
  for (const c of components) {
    if (typeof c.child === 'string') refs.add(c.child)
    if (typeof c.trigger === 'string') refs.add(c.trigger)
    if (typeof c.content === 'string') refs.add(c.content)
    if (Array.isArray(c.children)) {
      for (const ch of c.children) {
        if (typeof ch === 'string') refs.add(ch)
      }
    } else if (c.children && typeof c.children === 'object') {
      const tpl = c.children as Record<string, unknown>
      if (typeof tpl.componentId === 'string') refs.add(tpl.componentId)
    }
    if (Array.isArray(c.tabs)) {
      for (const t of c.tabs) {
        if (t && typeof t === 'object' && typeof (t as Record<string, unknown>).child === 'string') {
          refs.add((t as Record<string, unknown>).child as string)
        }
      }
    }
  }
  return refs
}

function componentsOf(update: Record<string, unknown>, rootAlias?: string): Record<string, unknown>[] {
  const raw = (update.components ?? update.componentList) as unknown
  if (!Array.isArray(raw)) return []
  const flat: Record<string, unknown>[] = []
  raw.forEach((comp, index) => {
    if (comp && typeof comp === 'object') flatten(comp as Record<string, unknown>, flat, `c${index}`)
  })
  if (!flat.length) return flat

  // If v0.8 beginRendering specified a custom root id, alias it to 'root' for v0.9.
  if (rootAlias && rootAlias !== 'root' && !flat.some((c) => c.id === 'root')) {
    const match = flat.find((c) => c.id === rootAlias)
    if (match) match.id = 'root'
  }

  // Ensure v0.9 surface always has a 'root' entry so shorthand messages render visibly.
  if (!flat.some((c) => c.id === 'root')) {
    const referenced = collectReferencedIds(flat)
    const topLevel = flat
      .map((c) => String(c.id))
      .filter((cid) => !referenced.has(cid))
    if (topLevel.length === 1) {
      const sole = flat.find((c) => c.id === topLevel[0])
      if (sole) sole.id = 'root'
    } else if (topLevel.length > 1) {
      flat.unshift({ id: 'root', component: 'Column', children: topLevel })
    }
  }

  return flat
}

/** Return spec messages, or null when nothing here can be drawn by the basic catalog. */
export function toOfficialMessages(messages: unknown, surfaceId = 'main'): Msg[] | null {
  if (!Array.isArray(messages) || messages.length === 0) return null
  const out: Msg[] = []
  const createdFirst: Msg[] = []
  let sid = surfaceId
  let rootAlias: string | undefined
  let sawPayload = false

  // First pass: capture v0.8 beginRendering root alias if present.
  for (const item of messages) {
    if (!item || typeof item !== 'object') continue
    const br = (item as Msg).beginRendering
    if (br && typeof br === 'object') {
      const rec = br as Msg
      if (typeof rec.surfaceId === 'string') sid = rec.surfaceId
      if (typeof rec.root === 'string' && rec.root) rootAlias = rec.root
    }
  }

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

    if (msg.beginRendering && typeof msg.beginRendering === 'object') {
      const br = msg.beginRendering as Msg
      sid = typeof br.surfaceId === 'string' ? br.surfaceId : sid
      const catalog = typeof br.catalogId === 'string' ? br.catalogId : 'basic'
      if (!LOOSE_CATALOGS.has(catalog)) return null
      const create: Msg = { surfaceId: sid, catalogId: BASIC_CATALOG_ID }
      if (br.styles && typeof br.styles === 'object') create.theme = br.styles
      createdFirst.push({ version: 'v0.9', createSurface: create })
      continue
    }

    const updateRaw =
      (msg.updateComponents && typeof msg.updateComponents === 'object' ? msg.updateComponents : null) ??
      (msg.surfaceUpdate && typeof msg.surfaceUpdate === 'object' ? msg.surfaceUpdate : null)
    if (updateRaw) {
      const update = updateRaw as Msg
      const components = componentsOf(update, rootAlias)
      if (!components.length) continue
      const updateSid = typeof update.surfaceId === 'string' ? update.surfaceId : sid
      out.push({ version: 'v0.9', updateComponents: { surfaceId: updateSid, components } })
      sawPayload = true
      continue
    }

    if (msg.updateDataModel && typeof msg.updateDataModel === 'object') {
      const udm = msg.updateDataModel as Msg
      const dataSid = typeof udm.surfaceId === 'string' ? udm.surfaceId : sid
      out.push({
        version: 'v0.9',
        updateDataModel: {
          surfaceId: dataSid,
          path: typeof udm.path === 'string' ? udm.path : '/',
          value: udm.value,
        },
      })
      sawPayload = true
      continue
    }

    if (msg.dataModelUpdate && typeof msg.dataModelUpdate === 'object') {
      const dmu = msg.dataModelUpdate as Msg
      const dataSid = typeof dmu.surfaceId === 'string' ? dmu.surfaceId : sid
      out.push({
        version: 'v0.9',
        updateDataModel: {
          surfaceId: dataSid,
          path: typeof dmu.path === 'string' ? dmu.path : '/',
          value: 'contents' in dmu ? convertV08Contents(dmu.contents) : dmu.value,
        },
      })
      sawPayload = true
      continue
    }

    if (msg.deleteSurface && typeof msg.deleteSurface === 'object') {
      const ds = msg.deleteSurface as Msg
      const delSid = typeof ds.surfaceId === 'string' ? ds.surfaceId : sid
      out.push({ version: 'v0.9', deleteSurface: { surfaceId: delSid } })
      sawPayload = true
    }
  }

  const combined = [...createdFirst, ...out]
  if (!combined.some((msg) => msg.createSurface) && !combined.some((msg) => msg.deleteSurface)) {
    combined.unshift({
      version: 'v0.9',
      createSurface: { surfaceId: sid, catalogId: BASIC_CATALOG_ID },
    })
  }
  return sawPayload ? combined : null
}
