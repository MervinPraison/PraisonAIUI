/**
 * State shared by every approval presentation (the inline gate, the
 * explained card, the keyboard strip): which decision is in flight and the
 * error to show.
 *
 * The decision in flight (`pending`) and a rejected one (`error`) come from
 * the tool part, so they survive the gate remounting; the local state only
 * covers the moment between the click and the store update.
 */
import { useState } from 'react'

export interface GateProps {
  /** The question: approval.prompt, else "Allow <tool>?". */
  prompt: string
  risk?: string
  /** APPROVAL_PENDING on the part: 'approve' | 'deny' while the decision is on its way. */
  pending?: string
  /** APPROVAL_ERROR on the part: the server rejected the decision. */
  error?: string
  respond: (approved: boolean) => Promise<void>
  toolName: string
  /** Server hint: a plain-language label for the tool. */
  label?: string
  /** The tool's description (artifact.description, emoji stripped). */
  description?: string
  agent?: string
  args?: Readonly<Record<string, unknown>>
  /**
   * The tool row's disclosure, when the presentation draws the row itself
   * (the explained card's header): whether the arguments panel is open, the
   * toggle, and the panel's id for aria-controls.
   */
  expand?: { open: boolean; toggle(): void; panelId: string }
}

/** What the default inline gate needs (the Thread builds it from the tool part). */
export type InlineGateProps = Pick<GateProps, 'prompt' | 'risk' | 'pending' | 'error' | 'respond'>

/**
 * `[busy, error, act]`: the decision in flight ('approve' | 'deny' | null),
 * the error to show, and the click handler (approved: true for Approve).
 */
export function useDecision({ pending, error, respond }: Pick<GateProps, 'pending' | 'error' | 'respond'>) {
  const [clicked, setClicked] = useState<null | 'approve' | 'deny'>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const act = async (approved: boolean) => {
    setClicked(approved ? 'approve' : 'deny')
    setLocalError(null)
    try {
      await respond(approved)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'The decision could not be sent')
    } finally {
      setClicked(null)
    }
  }
  const busy: null | 'approve' | 'deny' = pending === 'approve' || pending === 'deny' ? pending : clicked
  return [busy, error ?? localError, act] as const
}
