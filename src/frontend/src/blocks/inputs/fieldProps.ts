/** Class names and prop readers the filter inputs share. */
import { str } from '../normalize'

export const FIELD_LABEL = 'text-sm font-medium text-foreground'

/** A 28px toggle pill (DESIGN.md: chosen ones on the accent soft fill). */
export const PILL =
  'inline-flex h-7 items-center rounded-full border border-border px-3 text-xs font-medium text-muted-foreground outline-none transition-colors duration-100 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:border-transparent aria-pressed:bg-accent-soft aria-pressed:text-link motion-reduce:transition-none'

/** Props of a value-holding input: its submit key and label. */
export function fieldOf(p: Record<string, unknown>) {
  const label = str(p.label)
  const name = str(p.name)
  return { label, name, key: name || label, autoSubmit: p.auto_submit === true ? '' : undefined }
}
