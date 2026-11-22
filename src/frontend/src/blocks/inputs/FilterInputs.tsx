/**
 * `tags_input`, `date_range_input`, `segmented_input` and `filter_bar`.
 * Values post through the enclosing form (HiddenValue, or named native date
 * fields); `filter_bar` is a form that submits on change and shows the active
 * filters as chips (formState.filterChips).
 */
import { useId, useMemo, useState, type FormEvent, type JSX, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { BlockNode } from '@/sdk/registry'
import { BlockRenderer } from '../BlockRenderer'
import type { CoreBlockProps } from '../coreBlocks'
import { addTags, filterChips, optionList, presetList, presetRange } from '../formState'
import { arr, isRecord, str, toBlockNodes } from '../normalize'
import { useFormSubmit } from '../useFormSubmit'
import { fieldOf, FIELD_LABEL, PILL } from './fieldProps'
import { Chip, HiddenValue } from './shared'

export function TagsInput({ node }: CoreBlockProps): JSX.Element {
  const p = node.props ?? {}
  const f = fieldOf(p)
  const labelId = useId()
  const [tags, setTags] = useState(() => arr(p.value).map((v) => str(v)))
  const [draft, setDraft] = useState('')
  const commit = () => {
    if (draft.trim()) setTags((cur) => addTags(cur, draft))
    setDraft('')
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault() // Enter must not submit the form with the tag half typed
      commit()
    } else if (e.key === 'Backspace' && !draft && tags.length) {
      setTags((cur) => cur.slice(0, -1))
    }
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-auto-submit={f.autoSubmit}>
      {f.label && (
        <span id={labelId} className={FIELD_LABEL}>
          {f.label}
        </span>
      )}
      <HiddenValue name={f.name} label={f.label} value={tags} json />
      <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-1 rounded-md border border-input px-1 py-0.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
        {tags.map((t) => (
          <Chip key={t} removeLabel={`Remove ${t}`} onRemove={() => setTags((cur) => cur.filter((x) => x !== t))}>
            {t}
          </Chip>
        ))}
        {/* No name or aria-label: the typed text is not a form value (only the chips are). */}
        <input
          aria-labelledby={f.label ? labelId : undefined}
          title={f.label ? undefined : f.key}
          value={draft}
          placeholder={str(p.placeholder) || undefined}
          onChange={(e) => (e.target.value.includes(',') ? (setTags((cur) => addTags(cur, e.target.value)), setDraft('')) : setDraft(e.target.value))}
          onKeyDown={onKeyDown}
          onBlur={commit}
          className="h-6 min-w-24 flex-1 bg-transparent px-1.5 text-[1rem] text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
        />
      </div>
    </div>
  )
}

export function DateRangeInput({ node }: CoreBlockProps): JSX.Element {
  const p = node.props ?? {}
  const name = str(p.name)
  const label = str(p.label)
  const [range, setRange] = useState({ start: str(p.start), end: str(p.end) })
  const presets = useMemo(() => presetList(p.presets), [p.presets])
  const today = presetRange(0).end
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5" data-auto-submit={p.auto_submit === true ? '' : undefined}>
      {label && <legend className={cn(FIELD_LABEL, 'mb-1.5')}>{label}</legend>}
      {/* One change event per new range, so a preset that moves both ends posts once. */}
      <HiddenValue name="" label="" value={range} json />
      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {presets.map((pr) => {
            const r = presetRange(pr.days)
            const on = range.start === r.start && range.end === r.end
            return (
              <button key={pr.days} type="button" aria-pressed={on} className={PILL} onClick={() => setRange(r)}>
                {pr.label}
              </button>
            )
          })}
        </div>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <Input
          type="date"
          name={`${name}_start`}
          aria-label={`${label || name}: from`}
          value={range.start}
          max={range.end || today}
          onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
          className="min-w-0 flex-1"
        />
        <span aria-hidden className="text-sm text-muted-foreground">
          –
        </span>
        <Input
          type="date"
          name={`${name}_end`}
          aria-label={`${label || name}: to`}
          value={range.end}
          min={range.start || undefined}
          onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
          className="min-w-0 flex-1"
        />
      </div>
    </fieldset>
  )
}

export function SegmentedInput({ node }: CoreBlockProps): JSX.Element {
  const p = node.props ?? {}
  const f = fieldOf(p)
  const labelId = useId()
  const multi = p.multi === true
  const options = useMemo(() => optionList(p.options), [p.options])
  const [chosen, setChosen] = useState<string[]>(() => {
    if (multi) return arr(p.value).map((v) => str(v))
    const v = str(p.value)
    return [options.some((o) => o.value === v) ? v : (options[0]?.value ?? v)]
  })
  const pick = (v: string) =>
    setChosen((cur) => (!multi ? [v] : cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]))
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-auto-submit={f.autoSubmit}>
      {f.label && (
        <span id={labelId} className={FIELD_LABEL}>
          {f.label}
        </span>
      )}
      <HiddenValue name={f.name} label={f.label} value={multi ? chosen : (chosen[0] ?? '')} json={multi} />
      <div role="group" aria-labelledby={f.label ? labelId : undefined} aria-label={f.label ? undefined : f.key} className="flex flex-wrap gap-1">
        {options.map((o) => (
          <button key={o.value} type="button" aria-pressed={chosen.includes(o.value)} className={PILL} onClick={() => pick(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const WIDE = new Set(['date_range_input', 'segmented_input', 'multiselect_input', 'tags_input'])

/** Remount an input when the server sends it a new value (uncontrolled fields keep their own otherwise). */
function valueKey(n: BlockNode): string {
  const p = n.props ?? {}
  return JSON.stringify([p.value, p.checked, p.start, p.end])
}

export function FilterBar({ node, page }: CoreBlockProps): JSX.Element {
  const p = node.props ?? {}
  const nodes = Array.isArray(node.children) ? node.children : toBlockNodes(arr(p.inputs))
  const defaults = isRecord(p.defaults) ? p.defaults : {}
  const { chips, reset } = useMemo(() => filterChips(nodes, defaults), [nodes, defaults])
  const { formRef, busy, submit } = useFormSubmit('Filters', true)
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    void submit()
  }
  return (
    <form
      ref={formRef}
      role="search"
      aria-label={str(p.title, 'Filters')}
      aria-busy={busy || undefined}
      data-action={str(p.action) || undefined}
      onSubmit={onSubmit}
      className="flex min-w-0 flex-col gap-2"
    >
      <div className="flex min-w-0 flex-wrap items-end gap-3">
        {nodes.map((n, i) => (
          <div key={`${i}:${valueKey(n)}`} className={cn('min-w-0', WIDE.has(n.type) ? 'flex-[1_1_16rem]' : 'flex-[1_1_10rem] sm:max-w-64')}>
            <BlockRenderer node={n} page={page} />
          </div>
        ))}
      </div>
      {p.chips !== false && (chips.length > 0 || busy) && (
        <div role="group" aria-label="Active filters" className="flex min-w-0 flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <Chip key={c.key} removeLabel={`Clear ${c.label}: ${c.text}`} onRemove={() => void submit(c.patch)}>
              <span className="text-muted-foreground">{c.label}:</span> {c.text}
            </Chip>
          ))}
          {chips.length > 0 && (
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2" onClick={() => void submit(reset)}>
              {str(p.reset_label, 'Reset')}
            </Button>
          )}
          {busy && <Spinner aria-label="Applying filters" />}
        </div>
      )}
    </form>
  )
}
