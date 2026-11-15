/**
 * Follow-up chips under the latest finished answer (Guided's `turnFooter`
 * region): "You could ask next" and the run's `run_completed.suggestions`
 * (`aiui.suggest([...])`). A chip puts its prompt in the composer. Nothing
 * shows while the turn runs, on older turns, or when the server suggested
 * none. A lazy chunk of this layout, loaded with the first assistant turn.
 */
import type { JSX } from 'react'
import type { TurnRegionProps } from '@/sdk/layouts'
import { cn } from '@/lib/utils'
import { followUpsFor, useChat } from './chat'

export default function FollowUps({ messageId, viewport }: TurnRegionProps): JSX.Element | null {
  const { feed, state } = useChat()
  const chips = feed ? followUpsFor(state.messages, messageId) : []
  if (chips.length === 0) return null
  const phone = viewport === 'phone'
  return (
    <section aria-label="You could ask next" className="mt-4 flex flex-col gap-2" data-guided-followups>
      <span aria-hidden="true" className="text-sm font-bold text-muted-foreground">You could ask next</span>
      <div className="flex flex-wrap gap-2">
        {chips.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => feed?.prefill(text)}
            className={cn(
              'max-w-full rounded-full border border-primary/30 bg-card px-4 text-left text-[15px] font-semibold text-link outline-none transition-colors break-words',
              'hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-ring',
              phone ? 'min-h-11' : 'min-h-[42px]',
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </section>
  )
}
