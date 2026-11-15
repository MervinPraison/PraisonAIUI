/**
 * Follow-up chips under the latest finished answer (Guided's `turnFooter`
 * region): "You could ask next" and the run's `run_completed.suggestions`
 * (`aiui.suggest([...])`). A chip puts its prompt in the composer. Nothing
 * shows while the turn runs, on older turns, or when the server suggested
 * none. Every chip is a 44 px target. A lazy chunk of this layout, loaded
 * with the first assistant turn.
 */
import type { JSX } from 'react'
import type { TurnRegionProps } from '@/sdk/layouts'
import { followUpsFor, useChat } from './chat'

export default function FollowUps({ messageId }: TurnRegionProps): JSX.Element | null {
  const { feed, state } = useChat()
  const chips = feed ? followUpsFor(state.messages, messageId) : []
  if (chips.length === 0) return null
  return (
    <section aria-label="You could ask next" className="mt-4 flex flex-col gap-2" data-guided-followups>
      <span aria-hidden="true" className="text-sm font-bold text-muted-foreground">You could ask next</span>
      <div className="flex flex-wrap gap-2">
        {chips.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => feed?.prefill(text)}
            className="min-h-11 max-w-full rounded-full border border-primary/40 bg-card px-4 text-left text-[15px] font-semibold break-words text-link outline-none transition-colors hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-ring"
          >
            {text}
          </button>
        ))}
      </div>
    </section>
  )
}
