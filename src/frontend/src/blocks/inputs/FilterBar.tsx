/**
 * `filter_bar`: a form that lays its inputs in one wrapping row, submits on
 * change and shows the active filters as chips (formState.filterChips).
 */
import { useMemo, type FormEvent, type JSX } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { BlockNode } from '@/sdk/registry'
import { BlockRenderer } from '../BlockRenderer'
import type { CoreBlockProps } from '../coreBlocks'
import { filterChips } from '../formState'
import { arr, isRecord, str, toBlockNodes } from '../normalize'
import { useFormSubmit } from '../useFormSubmit'
import { Chip } from './shared'

/** Remount an input when the server sends it a new value (uncontrolled fields keep their own otherwise). */
function valueKey(n: BlockNode): string {
  const p = n.props ?? {}
  return JSON.stringify([p.value, p.checked])
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
          <div key={`${i}:${valueKey(n)}`} className="min-w-0 flex-[1_1_10rem] sm:max-w-64">
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
