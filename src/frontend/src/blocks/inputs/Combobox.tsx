/**
 * `select_input` with search (a combobox) and `multiselect_input` (chips).
 * The list filters itself (formState.filterOptions) and renders at most 100
 * rows, so a thousand options stay fast; cmdk gives the keyboard model and
 * listbox semantics. The value posts through a hidden input (HiddenValue).
 */
import { useId, useMemo, useState, type JSX } from 'react'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { CoreBlockProps } from '../coreBlocks'
import { filterOptions, optionList, type Option } from '../formState'
import { arr, str } from '../normalize'
import { fieldOf, FIELD_LABEL } from './fieldProps'
import { Chip, HiddenValue } from './shared'

function OptionSearch({
  options,
  label,
  isChosen,
  onPick,
}: {
  options: Option[]
  label: string
  isChosen(v: string): boolean
  onPick(v: string): void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => filterOptions(options, query), [options, query])
  return (
    <Command shouldFilter={false} loop>
      <CommandInput value={query} onValueChange={setQuery} placeholder="Search…" aria-label={`Search ${label}`} />
      <CommandList>
        <CommandEmpty>No match.</CommandEmpty>
        <CommandGroup>
          {shown.items.map((o, i) => (
            <CommandItem key={`${i}:${o.value}`} value={`${i}:${o.value}`} onSelect={() => onPick(o.value)}>
              <Check aria-hidden className={cn(isChosen(o.value) ? 'opacity-100' : 'opacity-0')} />
              <span className="truncate">{o.label || o.value || '(none)'}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      {shown.more > 0 && (
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground" aria-live="polite">
          {shown.more.toLocaleString()} more: type to narrow the list
        </p>
      )}
    </Command>
  )
}

const POPOVER = 'w-(--radix-popover-trigger-width) min-w-60 max-w-[calc(100vw-2rem)] p-0'

export function SearchableSelect({ node }: CoreBlockProps): JSX.Element {
  const p = node.props ?? {}
  const f = fieldOf(p)
  const labelId = useId()
  const options = useMemo(() => optionList(p.options), [p.options])
  const [value, setValue] = useState(() => {
    const v = str(p.value)
    return options.some((o) => o.value === v) ? v : (options[0]?.value ?? v)
  })
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-auto-submit={f.autoSubmit}>
      {f.label && (
        <span id={labelId} className={FIELD_LABEL}>
          {f.label}
        </span>
      )}
      <HiddenValue name={f.name} label={f.label} value={value} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-labelledby={f.label ? `${labelId} ${labelId}-v` : undefined}
            aria-label={f.label ? undefined : f.key}
            className="h-8 w-full min-w-0 justify-between px-2.5 font-normal dark:bg-input/30"
          >
            <span id={`${labelId}-v`} className="truncate">
              {current?.label || value || str(p.placeholder, 'Choose…')}
            </span>
            <ChevronsUpDown aria-hidden className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className={POPOVER}>
          <OptionSearch
            options={options}
            label={f.key}
            isChosen={(v) => v === value}
            onPick={(v) => {
              setValue(v)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

export function MultiSelect({ node }: CoreBlockProps): JSX.Element {
  const p = node.props ?? {}
  const f = fieldOf(p)
  const labelId = useId()
  const options = useMemo(() => optionList(p.options), [p.options])
  const [values, setValues] = useState(() => arr(p.value).map((v) => str(v)))
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label || v
  const toggle = (v: string) => setValues((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]))
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-auto-submit={f.autoSubmit}>
      {f.label && (
        <span id={labelId} className={FIELD_LABEL}>
          {f.label}
        </span>
      )}
      <HiddenValue name={f.name} label={f.label} value={values} json />
      <div
        role="group"
        aria-labelledby={f.label ? labelId : undefined}
        aria-label={f.label ? undefined : f.key}
        className="flex min-h-8 min-w-0 flex-wrap items-center gap-1 rounded-md border border-input px-1 py-0.5 dark:bg-input/30"
      >
        {values.map((v) => (
          <Chip key={v} removeLabel={`Remove ${labelOf(v)}`} onRemove={() => toggle(v)}>
            {labelOf(v)}
          </Chip>
        ))}
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-muted-foreground" aria-label={`Choose ${f.key}`}>
              <Plus aria-hidden />
              {values.length ? 'Add' : str(p.placeholder, 'Choose…')}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className={POPOVER}>
            <OptionSearch options={options} label={f.key} isChosen={(v) => values.includes(v)} onPick={toggle} />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
