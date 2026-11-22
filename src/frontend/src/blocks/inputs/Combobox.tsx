/**
 * `select_input` with search (a combobox). The list filters itself
 * (formState.filterOptions) and renders at most 100 rows, so a thousand
 * options stay fast; cmdk gives the keyboard model and listbox semantics.
 * The value posts through a hidden input (HiddenValue).
 */
import { useId, useMemo, useState, type JSX } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { CoreBlockProps } from '../coreBlocks'
import { filterOptions, optionList, type Option } from '../formState'
import { str } from '../normalize'
import { HiddenValue } from './shared'

function OptionSearch({ options, label, chosen, onPick }: { options: Option[]; label: string; chosen: string; onPick(v: string): void }): JSX.Element {
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
              <Check aria-hidden className={cn(o.value === chosen ? 'opacity-100' : 'opacity-0')} />
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

const FIELD_LABEL = 'text-sm font-medium text-foreground'

const POPOVER = 'w-(--radix-popover-trigger-width) min-w-60 max-w-[calc(100vw-2rem)] p-0'

export function SearchableSelect({ node }: CoreBlockProps): JSX.Element {
  const p = node.props ?? {}
  const f = { label: str(p.label), name: str(p.name), key: str(p.name) || str(p.label) }
  const labelId = useId()
  const options = useMemo(() => optionList(p.options), [p.options])
  const [value, setValue] = useState(() => {
    const v = str(p.value)
    return options.some((o) => o.value === v) ? v : (options[0]?.value ?? v)
  })
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-auto-submit={p.auto_submit === true ? '' : undefined}>
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
            chosen={value}
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
