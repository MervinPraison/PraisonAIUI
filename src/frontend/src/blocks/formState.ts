/**
 * Form logic shared by `form`, `filter_bar` and the filter inputs: how values
 * are collected, when a change submits, option search, date presets, tags and
 * the active-filter chips. Plain functions, so they are tested without a DOM.
 */
import type { BlockNode } from '@/sdk/registry'
import { arr, isRecord, str } from './normalize'

/** The key an element posts under: `name`, else its label (legacy form_action). */
export function fieldKey(el: Element): string {
  const e = el as HTMLInputElement
  return e.name || e.dataset?.label || el.getAttribute('aria-label') || ''
}

/**
 * Collect values exactly like the legacy form_action, so inputs rendered by
 * the legacy fallback inside a React form are collected too. An input marked
 * `data-aiui-json` holds a JSON value (a multi-select's list).
 */
export function collectFormValues(form: HTMLFormElement): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  form.querySelectorAll<HTMLInputElement>('input, select, textarea').forEach((el) => {
    const key = fieldKey(el)
    if (!key) return
    if (el.dataset.aiuiJson !== undefined) {
      try {
        data[key] = JSON.parse(el.value)
      } catch {
        data[key] = el.value
      }
    } else if (el.type === 'radio') {
      if (el.checked) data[key] = el.value
      else if (!(key in data)) data[key] = null
    } else if (el.type === 'checkbox') {
      data[key] = el.checked
    } else {
      data[key] = el.value
    }
  })
  return data
}

/** Custom controls (chips, pills, combobox) announce a new value with this event. */
export const INPUT_CHANGE = 'aiui:input-change'
export const AUTO_SUBMIT_EVENTS = ['input', 'change', INPUT_CHANGE] as const
export const DEBOUNCE_MS = 400

/**
 * Whether an event inside a form submits it: now, after the typing debounce,
 * or not at all. Only `aiui:input-change` and native events of fields that
 * post a value count (a chip box's draft text does not), and only when the form
 * submits on change or the field (or its wrapper) carries `data-auto-submit`.
 */
export function autoSubmitKind(e: Event, formAuto: boolean): 'now' | 'debounce' | null {
  const t = e.target
  if (!t || typeof (t as Element).closest !== 'function') return null
  if (!formAuto && !(t as Element).closest('[data-auto-submit]')) return null
  if (e.type === INPUT_CHANGE) return (e as CustomEvent<{ debounce?: boolean }>).detail?.debounce ? 'debounce' : 'now'
  if (!fieldKey(t as Element)) return null
  if (e.type === 'input') return 'debounce'
  return e.type === 'change' ? 'now' : null
}

export interface Option {
  value: string
  label: string
}

export function optionList(v: unknown): Option[] {
  return arr(v).map((o) =>
    isRecord(o) ? { value: str(o.value), label: str(o.label ?? o.value) } : { value: str(o), label: str(o) },
  )
}

/** A select with more options than this searches by default. */
export const SEARCHABLE_OVER = 20

export function isSearchable(p: Record<string, unknown>): boolean {
  if (typeof p.searchable === 'boolean') return p.searchable
  return arr(p.options).length > SEARCHABLE_OVER
}

/**
 * Options matching `query` (case-insensitive, label or value), names that
 * start with it first, at most `limit` of them: a list of a thousand stays
 * fast because only `limit` rows are ever rendered.
 */
export function filterOptions(options: Option[], query: string, limit = 100): { items: Option[]; more: number } {
  const q = query.trim().toLowerCase()
  let hits = options
  if (q) {
    const starts: Option[] = []
    const contains: Option[] = []
    for (const o of options) {
      const l = o.label.toLowerCase()
      if (l.startsWith(q)) starts.push(o)
      else if (l.includes(q) || o.value.toLowerCase().includes(q)) contains.push(o)
    }
    hits = starts.concat(contains)
  }
  return { items: hits.slice(0, limit), more: Math.max(0, hits.length - limit) }
}

/** Local calendar date as `YYYY-MM-DD`. */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export interface Preset {
  days: number
  label: string
}

export function presetList(v: unknown): Preset[] {
  const out: Preset[] = []
  for (const p of arr(v)) {
    const days = Number(isRecord(p) ? p.days : p)
    if (!Number.isFinite(days) || days <= 0) continue
    const label = isRecord(p) && str(p.label) ? str(p.label) : days === 365 ? '1 year' : `${days} days`
    out.push({ days, label })
  }
  return out
}

/** The range a preset stands for: `days` before today up to today. */
export function presetRange(days: number, today = new Date()): { start: string; end: string } {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days)
  return { start: isoDate(start), end: isoDate(today) }
}

/** Typed text → tags: split on commas, trimmed, no blanks or duplicates. */
export function addTags(current: string[], text: string): string[] {
  const out = [...current]
  for (const part of text.split(',')) {
    const t = part.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

// ── filter bar chips ─────────────────────────────────────────────────

export interface FilterChip {
  key: string
  label: string
  text: string
  /** Values to post on top of the form's to clear this filter. */
  patch: Record<string, unknown>
}

const TEXT_TYPES = new Set(['text_input', 'textarea_input', 'date_input', 'time_input'])
const CHOICE_TYPES = new Set(['select_input', 'radio_input'])
const LIST_TYPES = new Set(['multiselect_input', 'tags_input'])

const strList = (v: unknown) => arr(v).map((x) => str(x))

/**
 * The active filters of a filter bar (one chip per filter, one per value of
 * a list) and the values that reset them all. A filter is active when its
 * value differs from its reset value: `defaults[key]`, else the first option
 * of a single choice, else empty. Numbers only count when `defaults` names them.
 */
export function filterChips(nodes: BlockNode[], defaults: Record<string, unknown>): { chips: FilterChip[]; reset: Record<string, unknown> } {
  const chips: FilterChip[] = []
  const reset: Record<string, unknown> = {}
  for (const node of nodes) {
    const p = node.props ?? {}
    const key = str(p.name) || str(p.label)
    if (!key) continue
    const label = str(p.label) || key
    const has = Object.prototype.hasOwnProperty.call(defaults, key)
    const multi = LIST_TYPES.has(node.type) || (node.type === 'segmented_input' && p.multi === true)
    if (node.type === 'date_range_input') {
      const d = isRecord(defaults[key]) ? (defaults[key] as Record<string, unknown>) : {}
      const rs = str(d.start)
      const re = str(d.end)
      const s = str(p.start)
      const e = str(p.end)
      const patch = { [`${key}_start`]: rs, [`${key}_end`]: re }
      Object.assign(reset, patch)
      if (s !== rs || e !== re) chips.push({ key, label, text: `${s || '…'} – ${e || '…'}`, patch })
    } else if (multi) {
      const opts = optionList(p.options)
      const values = strList(p.value)
      const base = has ? strList(defaults[key]) : []
      reset[key] = base
      for (const v of values) {
        if (base.includes(v)) continue
        const text = opts.find((o) => o.value === v)?.label ?? v
        chips.push({ key: `${key}:${v}`, label, text, patch: { [key]: values.filter((x) => x !== v) } })
      }
    } else if (CHOICE_TYPES.has(node.type) || node.type === 'segmented_input') {
      const opts = optionList(p.options)
      const first = opts[0]?.value ?? ''
      let v = str(p.value)
      if (!opts.some((o) => o.value === v)) v = first
      const base = has ? str(defaults[key]) : first
      reset[key] = base
      if (v !== base) chips.push({ key, label, text: opts.find((o) => o.value === v)?.label ?? v, patch: { [key]: base } })
    } else if (node.type === 'checkbox_input' || node.type === 'switch_input') {
      const base = has ? defaults[key] === true : false
      reset[key] = base
      if ((p.checked === true) !== base) chips.push({ key, label, text: p.checked === true ? 'on' : 'off', patch: { [key]: base } })
    } else if (TEXT_TYPES.has(node.type) || (has && (node.type === 'number_input' || node.type === 'slider_input'))) {
      const base = has ? str(defaults[key]) : ''
      reset[key] = base
      const v = str(p.value)
      if (v !== base) chips.push({ key, label, text: v || '(empty)', patch: { [key]: base } })
    }
  }
  return { chips, reset }
}
