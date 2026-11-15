/**
 * Settings page data, pure (settings.test.ts): the config schema's sections
 * and fields, plain-language help for the known ones, values by dotted path,
 * and what changed.
 */

export interface FieldSchema {
  type?: string
  title?: string
  description?: string
  enum?: unknown[]
  format?: string
  default?: unknown
  minimum?: number
  maximum?: number
}

export interface SettingsField {
  /** Dotted path in the config ("model.temperature"). */
  path: string
  key: string
  title: string
  help: string
  kind: 'select' | 'switch' | 'number' | 'secret' | 'text'
  options: string[]
  schema: FieldSchema
}

export interface SettingsSection {
  id: string
  title: string
  description: string
  fields: SettingsField[]
}

export type Config = Record<string, unknown>

/** Help for the fields the server's schema ships without a description. */
const HELP: Record<string, string> = {
  'provider.name': 'The service that runs your models. Changing it may need a different API key.',
  'provider.api_key': 'Kept on this server and sent only to the provider. Leave empty to use the environment variable.',
  'provider.api_base': 'Only for a proxy or a self-hosted, OpenAI-compatible endpoint. Leave empty for the provider’s own.',
  'model.name': 'Used for new chats and for agents without their own model.',
  'model.temperature': 'Lower gives focused, repeatable answers; higher gives more varied ones. 0.7 suits most tasks.',
  'model.max_tokens': 'The longest answer a model may write. Leave empty for the model’s own limit.',
  'server.host': '0.0.0.0 accepts connections from other machines; 127.0.0.1 only from this one.',
  'server.port': 'The port the web UI and API listen on. Takes effect after a restart.',
  'server.debug': 'More detail in the log and in error pages. Turn off in production.',
  'auth.require_auth': 'Ask everyone to sign in before they can use the UI or the API.',
  'auth.api_key': 'A key scripts can send instead of signing in.',
  'logging.level': 'The least important lines the server keeps. INFO suits most setups.',
  'logging.format': 'How each log line is written (Python logging format).',
}

const SECTION_HELP: Record<string, string> = {
  provider: 'Connect the service that runs your models.',
  model: 'The model your agents use by default and how it answers.',
  server: 'Where the server listens. Most changes take effect after a restart.',
  auth: 'Who can use this server.',
  logging: 'What the server writes to its log.',
}

/**
 * Labels in sentence case, as the rest of the shell writes them: "Provider
 * Name" → "Provider name"; an acronym ("API Base URL") or a word with a digit
 * keeps its capitals.
 */
export function sentenceCase(title: string): string {
  return title
    .split(' ')
    .map((w, i) => (i === 0 || /^[A-Z0-9]{2,}$/.test(w) || /\d/.test(w) ? w : w.toLowerCase()))
    .join(' ')
}

const humanize = (k: string) => k.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

function kindOf(s: FieldSchema): SettingsField['kind'] {
  if (Array.isArray(s.enum) && s.enum.length) return 'select'
  if (s.type === 'boolean') return 'switch'
  if (s.type === 'number' || s.type === 'integer') return 'number'
  if (s.format === 'password') return 'secret'
  return 'text'
}

/** The schema's object properties as sections of leaf fields. */
export function settingsSections(schema: unknown): SettingsSection[] {
  const props = schema && typeof schema === 'object' ? (schema as { properties?: Record<string, unknown> }).properties : null
  if (!props) return []
  const out: SettingsSection[] = []
  for (const [id, raw] of Object.entries(props)) {
    const sec = (raw ?? {}) as { title?: string; description?: string; properties?: Record<string, FieldSchema> }
    if (!sec.properties) continue
    out.push({
      id,
      title: sec.title?.replace(/\s+Settings$/, '') || humanize(id),
      description: sec.description || SECTION_HELP[id] || '',
      fields: Object.entries(sec.properties).map(([key, s]) => {
        const path = `${id}.${key}`
        return {
          path,
          key,
          title: sentenceCase(s.title || humanize(key)),
          help: s.description || HELP[path] || '',
          kind: kindOf(s),
          options: Array.isArray(s.enum) ? s.enum.map(String) : [],
          schema: s,
        }
      }),
    })
  }
  return out
}

export function getPath(cfg: Config, path: string): unknown {
  let v: unknown = cfg
  for (const k of path.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined
  return v
}

export function setPath(cfg: Config, path: string, value: unknown): Config {
  const [head, ...rest] = path.split('.')
  const child = cfg[head] && typeof cfg[head] === 'object' ? (cfg[head] as Config) : {}
  return { ...cfg, [head]: rest.length ? setPath(child, rest.join('.'), value) : value }
}

/** The saved value, else the schema default, else the server defaults. */
export function valueOf(cfg: Config, defaults: Config, f: SettingsField): unknown {
  const v = getPath(cfg, f.path)
  if (v !== undefined) return v
  const d = getPath(defaults, f.path)
  return d !== undefined ? d : f.schema.default
}

/** Paths whose draft value differs from the saved one. */
export function changedPaths(sections: readonly SettingsSection[], saved: Config, draft: Config): string[] {
  return sections.flatMap((s) => s.fields.map((f) => f.path)).filter((p) => JSON.stringify(getPath(saved, p)) !== JSON.stringify(getPath(draft, p)))
}

/** Fields matching a search, by title, path or help. */
export function matchField(f: SettingsField, q: string): boolean {
  const s = q.trim().toLowerCase()
  return !s || f.title.toLowerCase().includes(s) || f.path.toLowerCase().includes(s) || f.help.toLowerCase().includes(s)
}
