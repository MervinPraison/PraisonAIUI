/** Components the filter inputs share: a removable chip, the hidden value and its change event. */
import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { INPUT_CHANGE } from '../formState'
import { str } from '../normalize'

/**
 * The value a custom control posts, as a hidden input the form collects.
 * After a user change (not the first render) it fires `aiui:input-change`,
 * which submits the form when it submits on change.
 */
export function HiddenValue({ name, label, value }: { name: string; label: string; value: unknown }) {
  const ref = useRef<HTMLInputElement>(null)
  const text = str(value)
  const prev = useRef(text)
  useEffect(() => {
    if (prev.current === text) return
    prev.current = text
    ref.current?.dispatchEvent(new CustomEvent(INPUT_CHANGE, { bubbles: true, detail: {} }))
  }, [text])
  return (
    <input
      ref={ref}
      type="hidden"
      readOnly
      name={name || undefined}
      data-label={label || undefined}
      value={text}
    />
  )
}

/** A chip with a button that removes it. */
export function Chip({ children, removeLabel, onRemove }: { children: ReactNode; removeLabel: string; onRemove(): void }) {
  return (
    <span className="inline-flex h-6 min-w-0 max-w-full items-center gap-0.5 rounded-full bg-accent-soft pl-2.5 pr-0.5 text-xs text-foreground">
      <span className="truncate">{children}</span>
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className={cn(
          'grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:text-foreground',
          'focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <X aria-hidden className="size-3" />
      </button>
    </span>
  )
}
