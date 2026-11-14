/**
 * The settings dialog: open state (tiny, on the boot path) and the pure form
 * helpers its lazy chunk uses (draft ↔ values, server field errors).
 */
import { useSyncExternalStore } from 'react'
import type { NormalizedSettingsField, SettingsValue, SettingsValues } from '@/sdk/contributions'

// ── open state ───────────────────────────────────────────────────────

export interface SettingsDialogState {
  open: boolean
  /** True once opened: the dialog chunk then stays mounted. */
  requested: boolean
  /** The section to show first, or null for the first one. */
  sectionId: string | null
}

let state: SettingsDialogState = { open: false, requested: false, sectionId: null }
const listeners = new Set<() => void>()

function setState(next: Partial<SettingsDialogState>) {
  state = { ...state, ...next }
  for (const fn of [...listeners]) fn()
}

export function openSettingsDialog(sectionId: string | null = null): void {
  setState({ open: true, requested: true, sectionId })
}

export function setSettingsDialogOpen(open: boolean): void {
  if (open !== state.open) setState({ open })
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const getSettingsDialogState = (): SettingsDialogState => state

export function useSettingsDialog(): SettingsDialogState {
  return useSyncExternalStore(subscribe, getSettingsDialogState, getSettingsDialogState)
}

export function preloadSettingsDialog(): void {
  void import('./SettingsDialog').catch(() => {
    /* retried on open */
  })
}

// ── form helpers ─────────────────────────────────────────────────────

/** What the controls hold: text for text and number inputs, booleans for switches. */
export type SettingsDraft = Record<string, string | boolean>

function fits(field: NormalizedSettingsField, v: unknown): v is SettingsValue {
  switch (field.type) {
    case 'boolean':
      return typeof v === 'boolean'
    case 'number':
      return typeof v === 'number' && Number.isFinite(v)
    case 'select':
      return field.options.some((o) => o.value === v)
    default:
      return typeof v === 'string'
  }
}

/** Saved values (defaults where a key is missing or no longer fits) as control state. */
export function toDraft(fields: readonly NormalizedSettingsField[], values: Partial<SettingsValues>): SettingsDraft {
  const out: SettingsDraft = {}
  for (const f of fields) {
    const v = fits(f, values[f.key]) ? values[f.key]! : f.default
    out[f.key] = f.type === 'boolean' ? v === true : String(v)
  }
  return out
}

/** Control state back to values; a number that does not parse is an error for that key. */
export function fromDraft(
  fields: readonly NormalizedSettingsField[],
  draft: SettingsDraft,
): { values: SettingsValues; errors: Record<string, string> } {
  const values: SettingsValues = {}
  const errors: Record<string, string> = {}
  for (const f of fields) {
    const raw = draft[f.key]
    if (f.type === 'boolean') {
      values[f.key] = raw === true
    } else if (f.type === 'number') {
      const text = String(raw ?? '').trim()
      const n = Number(text)
      if (text === '' || !Number.isFinite(n)) errors[f.key] = 'Enter a number'
      else values[f.key] = n
    } else {
      values[f.key] = String(raw ?? '')
    }
  }
  return { values, errors }
}

export function sameDraft(a: SettingsDraft, b: SettingsDraft): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((k) => a[k] === b[k])
}

/** `{key: reason}` from a rejected save (the server's 400 `{error, fields}`), else {}. */
export function fieldErrorsOf(err: unknown): Record<string, string> {
  const body = (err as { body?: unknown } | null)?.body
  const fields = typeof body === 'object' && body !== null ? (body as { fields?: unknown }).fields : undefined
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) return {}
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => typeof v === 'string')) as Record<string, string>
}
