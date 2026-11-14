/**
 * Shell contributions a plugin declares rather than renders: settings
 * sections (drawn by the shell's settings dialog), sidebar nav groups (their
 * order and fold state) and theme presets (seed tokens).
 *
 * One store per kind, filled two ways that end in the same registration:
 *  - a Python plugin's `settings()`, `nav_groups()` and `themes()` hooks
 *    arrive on its manifest record and are registered by
 *    seedManifestContributions() when the shell boots;
 *  - a browser module calls registerSettingsSection / registerNavGroup /
 *    registerThemePreset from `@aiui/sdk`.
 *
 * The shell reads the stores (useSettingsSections, useNavGroupDeclarations,
 * useThemePresets); the SDK never imports the shell.
 */
import { useSyncExternalStore } from 'react'
import type { ShellManifest } from './manifest'
import { fetchJson } from './services'

// ── a tiny keyed store ───────────────────────────────────────────────

interface Store<T> {
  /** Add or replace `key`; returns a remover that only removes this entry. */
  set(key: string, value: T, kind: string): () => void
  get(): readonly T[]
  use(): readonly T[]
}

function createStore<T>(sort?: (a: T, b: T) => number): Store<T> {
  const entries = new Map<string, T>()
  const listeners = new Set<() => void>()
  let snapshot: readonly T[] = Object.freeze([])
  const emit = () => {
    const list = [...entries.values()]
    snapshot = Object.freeze(sort ? list.sort(sort) : list)
    for (const fn of [...listeners]) fn()
  }
  const subscribe = (fn: () => void) => {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }
  const get = () => snapshot
  return {
    set(key, value, kind) {
      if (entries.has(key)) console.warn(`[aiui sdk] ${kind}('${key}') replaces an earlier registration`)
      entries.set(key, value)
      emit()
      return () => {
        if (entries.get(key) !== value) return
        entries.delete(key)
        emit()
      }
    },
    get,
    use: () => useSyncExternalStore(subscribe, get, get),
  }
}

function fail(kind: string, msg: string): never {
  throw new TypeError(`[aiui sdk] ${kind}: ${msg}`)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function optionalNumber(kind: string, what: string, v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(kind, `${what} must be a finite number`)
  return v
}

// ── settings sections ────────────────────────────────────────────────

export type SettingsFieldType = 'string' | 'text' | 'number' | 'boolean' | 'select'
export type SettingsValue = string | number | boolean
export type SettingsValues = Record<string, SettingsValue>

export interface SettingsOption {
  value: string
  label?: string
}

export interface SettingsField {
  /** Value key, `[A-Za-z_][A-Za-z0-9_]*`. */
  key: string
  label?: string
  /** Default `string`. */
  type?: SettingsFieldType
  /** Default `''`, `0`, `false`, or the first option. */
  default?: SettingsValue
  description?: string
  /** `select` only. */
  options?: readonly (string | SettingsOption)[]
}

export interface SettingsSectionInput {
  /** Unique id, by convention `<plugin>.<section>`. */
  id: string
  title: string
  description?: string
  /** Position in the settings dialog: lower comes first. Default 100. */
  order?: number
  fields: readonly SettingsField[]
  /** Read the saved values. */
  load(): Promise<SettingsValues>
  /** Save `values` (the whole section); resolve with the values now saved, or nothing. */
  save(values: SettingsValues): Promise<SettingsValues | void>
}

/** A registered section, as the shell renders it (fields normalised). */
export interface SettingsSection extends SettingsSectionInput {
  order: number
  fields: readonly NormalizedSettingsField[]
}

export interface NormalizedSettingsField {
  key: string
  label: string
  type: SettingsFieldType
  default: SettingsValue
  description: string
  options: readonly Required<SettingsOption>[]
}

const FIELD_TYPES: readonly SettingsFieldType[] = ['string', 'text', 'number', 'boolean', 'select']
const FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const TYPE_DEFAULTS: Record<Exclude<SettingsFieldType, 'select'>, SettingsValue> = {
  string: '',
  text: '',
  number: 0,
  boolean: false,
}

function normalizeField(kind: string, raw: unknown): NormalizedSettingsField {
  if (!isRecord(raw)) fail(kind, 'every field must be an object')
  const key = raw.key
  if (typeof key !== 'string' || !FIELD_KEY.test(key)) fail(kind, `invalid field key ${String(key)}`)
  const type = (raw.type ?? 'string') as SettingsFieldType
  if (!FIELD_TYPES.includes(type)) fail(kind, `field '${key}': unknown type ${String(raw.type)}`)
  let options: Required<SettingsOption>[] = []
  if (type === 'select') {
    if (!Array.isArray(raw.options) || raw.options.length === 0) fail(kind, `field '${key}': a select needs options`)
    options = raw.options.map((o: unknown) => {
      if (typeof o === 'string') return { value: o, label: o }
      if (isRecord(o) && typeof o.value === 'string') {
        return { value: o.value, label: typeof o.label === 'string' && o.label ? o.label : o.value }
      }
      return fail(kind, `field '${key}': invalid option ${String(o)}`)
    })
  }
  const fallback = type === 'select' ? options[0].value : TYPE_DEFAULTS[type]
  const value = raw.default ?? fallback
  const ok =
    type === 'select'
      ? options.some((o) => o.value === value)
      : type === 'number'
        ? typeof value === 'number' && Number.isFinite(value)
        : type === 'boolean'
          ? typeof value === 'boolean'
          : typeof value === 'string'
  if (!ok) fail(kind, `field '${key}': default does not fit type ${type}`)
  return {
    key,
    label: typeof raw.label === 'string' && raw.label ? raw.label : key,
    type,
    default: value as SettingsValue,
    description: typeof raw.description === 'string' ? raw.description : '',
    options,
  }
}

const sections = createStore<SettingsSection>((a, b) => a.order - b.order || a.title.localeCompare(b.title))

/**
 * Add a section to the shell's settings dialog. The shell renders `fields`
 * (text, multi-line text, number, switch, select), calls `load()` when the
 * section opens and `save(values)` on Save. A rejection of `save` whose
 * error has `body.fields` ({key: reason}) is shown next to those fields.
 * Registering an id again replaces that section. Returns a remover.
 *
 * A Python plugin declares the same thing with `settings()`; the shell then
 * loads and saves through `/api/plugins/<name>/settings/<id>`.
 */
export function registerSettingsSection(section: SettingsSectionInput): () => void {
  const kind = 'registerSettingsSection'
  if (!isRecord(section)) fail(kind, 'expected a section object')
  const { id, title, load, save } = section
  if (typeof id !== 'string' || !id) fail(kind, `expected a non-empty string id, got ${String(id)}`)
  if (typeof title !== 'string' || !title) fail(kind, `section '${id}' needs a title`)
  if (typeof load !== 'function' || typeof save !== 'function') fail(kind, `section '${id}' needs load() and save()`)
  if (!Array.isArray(section.fields) || section.fields.length === 0) fail(kind, `section '${id}' has no fields`)
  const fields = section.fields.map((f) => normalizeField(`${kind}('${id}')`, f))
  if (new Set(fields.map((f) => f.key)).size !== fields.length) fail(kind, `section '${id}' repeats a field key`)
  const entry: SettingsSection = Object.freeze({
    ...section,
    order: optionalNumber(kind, 'order', section.order) ?? 100,
    fields: Object.freeze(fields),
  })
  return sections.set(id, entry, kind)
}

/** Registered settings sections, sorted by `order` then title (shell hosts). */
export const getSettingsSections = sections.get
export const useSettingsSections = sections.use

// ── nav groups ───────────────────────────────────────────────────────

export interface NavGroupOptions {
  /**
   * Position among the sidebar groups: the groups the app lists in
   * `layout.groups.order` sit at 100, 200, 300…, groups without an order
   * follow them, and `layout.groups.last` stays last.
   */
  order?: number
  /** Start collapsed (until the viewer opens it). */
  folded?: boolean
}

export interface NavGroupDeclaration {
  name: string
  order?: number
  folded: boolean
}

const navGroups = createStore<NavGroupDeclaration>()

/**
 * Declare a sidebar group your pages use (their manifest `group`). The
 * app's own `layout.groups` wins for a group it names. Returns a remover.
 */
export function registerNavGroup(name: string, opts: NavGroupOptions = {}): () => void {
  const kind = 'registerNavGroup'
  if (typeof name !== 'string' || !name.trim()) fail(kind, `expected a non-empty group name, got ${String(name)}`)
  if (!isRecord(opts)) fail(kind, 'options must be an object')
  const entry: NavGroupDeclaration = Object.freeze({
    name: name.trim(),
    order: optionalNumber(kind, 'order', opts.order),
    folded: opts.folded === true,
  })
  return navGroups.set(entry.name, entry, kind)
}

export const getNavGroupDeclarations = navGroups.get
export const useNavGroupDeclarations = navGroups.use

// ── theme presets ────────────────────────────────────────────────────

export interface ThemePresetInput {
  /** Unique id, by convention `<plugin>.<name>`. */
  id: string
  label: string
  /** Seed tokens for light mode: `{ '--seed-accent': '#ea580c' }`. */
  light?: Readonly<Record<string, string>>
  /** Seed tokens for dark mode. */
  dark?: Readonly<Record<string, string>>
}

export interface ThemePreset {
  id: string
  label: string
  light: Readonly<Record<string, string>>
  dark: Readonly<Record<string, string>>
}

/** Same rule as the server (plugin_registry._THEME_TOKEN / _THEME_VALUE). */
const THEME_TOKEN = /^--(seed-[a-z0-9-]{1,40}|radius|tint-mix|accent-mix)$/
const THEME_VALUE = /^[#A-Za-z0-9 .,%()+\-/]{1,120}$/
const PRESET_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function themeTokens(kind: string, raw: unknown): Readonly<Record<string, string>> {
  if (raw === undefined || raw === null) return Object.freeze({})
  if (!isRecord(raw)) fail(kind, 'light/dark must be objects of seed tokens')
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    const name = k.startsWith('--') ? k : `--${k}`
    const value = String(v).trim()
    if (!THEME_TOKEN.test(name)) fail(kind, `'${k}' is not a seed token (--seed-*, --radius, --tint-mix, --accent-mix)`)
    if (!THEME_VALUE.test(value) || /url\(/i.test(value)) fail(kind, `unsafe value for ${name}`)
    out[name] = value
  }
  return Object.freeze(out)
}

const presets = createStore<ThemePreset>()

/**
 * Offer a theme preset: L0 seed tokens per mode, from which the shell
 * derives every surface, text and accent colour. The viewer picks it in the
 * command palette. Returns a remover.
 */
export function registerThemePreset(preset: ThemePresetInput): () => void {
  const kind = 'registerThemePreset'
  if (!isRecord(preset)) fail(kind, 'expected a preset object')
  const { id } = preset
  if (typeof id !== 'string' || !PRESET_ID.test(id)) fail(kind, `invalid preset id ${String(id)}`)
  const light = themeTokens(`${kind}('${id}')`, preset.light)
  const dark = themeTokens(`${kind}('${id}')`, preset.dark)
  if (!Object.keys(light).length && !Object.keys(dark).length) fail(kind, `preset '${id}' sets no tokens`)
  const label = typeof preset.label === 'string' && preset.label ? preset.label : id
  return presets.set(id, Object.freeze({ id, label, light, dark }), kind)
}

export const getThemePresets = presets.get
export const useThemePresets = presets.use

// ── from the manifest (Python hooks) ─────────────────────────────────

interface ValuesResponse {
  values?: SettingsValues
}

function valuesOf(res: ValuesResponse | undefined): SettingsValues {
  return isRecord(res?.values) ? (res.values as SettingsValues) : {}
}

const seeded = new WeakSet<ShellManifest>()

/**
 * Register what the manifest's plugin records declare (`settings`,
 * `navGroups`, `themes`, from the Python hooks). Ids are prefixed with the
 * plugin name. One bad entry is logged and skipped. Once per manifest.
 */
export function seedManifestContributions(manifest: ShellManifest): void {
  if (seeded.has(manifest)) return
  seeded.add(manifest)
  for (const rec of manifest.plugins) {
    if (rec.status !== 'ok') continue
    const tryEach = <T>(list: readonly T[] | undefined, register: (item: T) => void) => {
      for (const item of Array.isArray(list) ? list : []) {
        try {
          register(item)
        } catch (err) {
          console.warn(`[aiui sdk] plugin ${rec.name}: skipped a declared contribution`, err)
        }
      }
    }
    tryEach(rec.settings, (s) => {
      const endpoint = s.endpoint
      registerSettingsSection({
        id: `${rec.name}.${s.id}`,
        title: s.title,
        description: s.description,
        order: s.order,
        fields: s.fields,
        load: async () => valuesOf(await fetchJson<ValuesResponse>(endpoint)),
        save: async (values) => valuesOf(await fetchJson<ValuesResponse>(endpoint, { method: 'PUT', body: { values } })),
      })
    })
    tryEach(rec.navGroups, (g) => registerNavGroup(g.name, { order: g.order ?? undefined, folded: g.folded }))
    tryEach(rec.themes, (t) => registerThemePreset({ ...t, id: `${rec.name}.${t.id}` }))
  }
}
