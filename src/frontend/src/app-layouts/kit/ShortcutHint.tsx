import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { shortcutLabels } from './useShortcut'

/** Keycaps on an accent button (Pro `kbdOn`): the on-accent colour at low alpha. */
const ON_ACCENT = 'border-primary-foreground/30 bg-primary-foreground/15 text-primary-foreground'

/**
 * Keycaps for a shortcut (`mod+k` → ⌘ K). Decorative: say the shortcut in the
 * control's label. `tone="on-accent"` for keycaps on a primary button.
 */
export function ShortcutHint({ combo, className, tone = 'default' }: { combo: string; className?: string; tone?: 'default' | 'on-accent' }) {
  const labels = shortcutLabels(combo)
  return (
    <KbdGroup aria-hidden="true" data-aiui-shortcut={combo} className={cn('ml-auto', className)}>
      {labels.map((l, i) => (
        <Kbd key={i} className={cn(tone === 'on-accent' && ON_ACCENT)}>
          {l}
        </Kbd>
      ))}
    </KbdGroup>
  )
}
