/**
 * `select_input` with search (a combobox) and `multiselect_input` (chips).
 * The list filters itself (formState.filterOptions) and renders at most 100
 * rows, so a thousand options stay fast; cmdk gives the keyboard model and
 * listbox semantics. The value posts through a hidden input (HiddenValue).
 */
import { useEffect, useId, useMemo, useRef, useState, type JSX } from 'react'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { CoreBlockProps } from '../coreBlocks'
import { filterOptions, optionList, parseRemoteOptions, remoteOptionsUrl, type Option } from '../formState'
import { arr, isRecord, safeUrl, str } from '../normalize'
import { fieldOf, FIELD_LABEL } from './fieldProps'
import { Chip, HiddenValue } from './shared'

const REMOTE_DEBOUNCE_MS = 200

function OptionSearch({
  options,
  optionsUrl,
  label,
  isChosen,
  onPick,
  onLoaded,
}: {
  options: Option[]
  optionsUrl?: string
  label: string
  isChosen(v: string): boolean
  onPick(v: string, lbl: string): void
  onLoaded?(opts: Option[]): void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [remote, setRemote] = useState<Option[]>(options)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const onLoadedRef = useRef(onLoaded)
  useEffect(() => {
    onLoadedRef.current = onLoaded
  }, [onLoaded])

  useEffect(() => {
    if (!optionsUrl) return
    const ac = new AbortController()
    const timer = setTimeout(async () => {
      const url = remoteOptionsUrl(optionsUrl, query)
      if (!url) return
      setLoading(true)
      setError('')
      try {
        const res = await fetch(url, {
          headers: { Accept: 'application/json' },
          credentials: 'same-origin',
          signal: ac.signal,
        })
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim())
        const parsed = parseRemoteOptions(await res.json())
        if (ac.signal.aborted) return
        setRemote(parsed)
        onLoadedRef.current?.(parsed)
      } catch (err) {
        if (ac.signal.aborted) return
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!ac.signal.aborted) setLoading(false)
      }
    }, query ? REMOTE_DEBOUNCE_MS : 0)
    return () => {
      clearTimeout(timer)
      ac.abort()
    }
  }, [optionsUrl, query])

  const shown = useMemo(
    () => (optionsUrl ? { items: remote.slice(0, 100), more: Math.max(0, remote.length - 100) } : filterOptions(options, query)),
    [optionsUrl, remote, options, query],
  )
  return (
    <Command shouldFilter={false} loop>
      <CommandInput value={query} onValueChange={setQuery} placeholder="Search…" aria-label={`Search ${label}`} />
      <CommandList>
        {loading && (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground" role="status">
            <Spinner size="sm" aria-label="Searching options" />
          </div>
        )}
        {!loading && error && (
          <p className="px-3 py-2 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && <CommandEmpty>No match.</CommandEmpty>}
        <CommandGroup>
          {shown.items.map((o, i) => (
            <CommandItem key={`${i}:${o.value}`} value={`${i}:${o.value}`} onSelect={() => onPick(o.value, o.label || o.value)}>
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
  const optionsUrl = safeUrl(p.options_url)
  const [value, setValue] = useState(() => {
    const v = str(p.value)
    if (optionsUrl) return v
    return options.some((o) => o.value === v) ? v : (options[0]?.value ?? v)
  })
  const [knownLabels, setKnownLabels] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const o of options) map[o.value] = o.label
    if (str(p.value) && str(p.selected_label)) map[str(p.value)] = str(p.selected_label)
    return map
  })
  const [open, setOpen] = useState(false)
  const currentLabel = knownLabels[value] || options.find((o) => o.value === value)?.label || value
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
              {currentLabel || str(p.placeholder, 'Choose…')}
            </span>
            <ChevronsUpDown aria-hidden className="opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className={POPOVER}>
          <OptionSearch
            options={options}
            optionsUrl={optionsUrl}
            label={f.key}
            isChosen={(v) => v === value}
            onLoaded={(opts) =>
              setKnownLabels((prev) => {
                const next = { ...prev }
                for (const o of opts) next[o.value] = o.label
                return next
              })
            }
            onPick={(v, lbl) => {
              setKnownLabels((prev) => ({ ...prev, [v]: lbl }))
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
  const optionsUrl = safeUrl(p.options_url)
  const [values, setValues] = useState(() => arr(p.value).map((v) => str(v)))
  const [knownLabels, setKnownLabels] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    for (const o of options) map[o.value] = o.label
    if (isRecord(p.selected_labels)) {
      for (const [k, v] of Object.entries(p.selected_labels)) map[k] = str(v)
    }
    return map
  })
  const labelOf = (v: string) => knownLabels[v] || options.find((o) => o.value === v)?.label || v
  const toggle = (v: string, lbl?: string) => {
    if (lbl) setKnownLabels((prev) => ({ ...prev, [v]: lbl }))
    setValues((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]))
  }
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
            <OptionSearch
              options={options}
              optionsUrl={optionsUrl}
              label={f.key}
              isChosen={(v) => values.includes(v)}
              onLoaded={(opts) =>
                setKnownLabels((prev) => {
                  const next = { ...prev }
                  for (const o of opts) next[o.value] = o.label
                  return next
                })
              }
              onPick={toggle}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
