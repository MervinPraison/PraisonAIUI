import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { shortcutLabels } from './useShortcut'

/** Keycaps for a shortcut (`mod+k` → ⌘ K). Decorative: say the shortcut in the control's label. */
export function ShortcutHint({ combo, className }: { combo: string; className?: string }) {
  const labels = shortcutLabels(combo)
  return (
    <KbdGroup aria-hidden="true" data-aiui-shortcut={combo} className={cn('ml-auto', className)}>
      {labels.map((l, i) => (
        <Kbd key={i}>{l}</Kbd>
      ))}
    </KbdGroup>
  )
}
