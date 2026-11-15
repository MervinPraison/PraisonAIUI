/**
 * The chat's layout presentation host (ADR 0003 §1.3): one lazy chunk the
 * chat page loads only while a layout declares `meta.chat`. It holds the
 * small wrappers the Thread and the page render; each feature behind them
 * is its own lazy chunk again, fetched only when the layout asks for it:
 *
 *   Gate          approvals 'card' (./ApprovalCard) or 'keyboard' (./KeyboardGate);
 *                 in the 'steps' thread it is pinned above the composer
 *   Pinned        that place above the composer (./pinned), and the
 *                 composer's model button (./ComposerModel, composer.css)
 *   Turn          one assistant turn: the variant's turn header (./TurnMeta)
 *                 and stylesheet (./quiet.css, ./bubbles.css…), and the
 *                 layout's turnHeader / turnFooter regions around it
 *   Empty         an empty thread: the layout's `empty` region or the starters
 *   Region        a layout region (turnHeader, turnFooter, empty) via ../LazyRegion
 *   Aside         the side panel / phone switch for `aside` (./Aside)
 *
 * Gate, Turn and Empty take the presentation and wrap the default they
 * replace (`children`), which is what shows without that feature.
 *
 * The state behind them (viewport, the aside badge) is in ./regionState.
 * Keeping all of it out of the chat route leaves that route's budget
 * (R10) to the chat itself: it carries only the calls into this module.
 */
import { lazy, useEffect, useMemo, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useAuiState, type ToolCallMessagePartProps } from '@assistant-ui/react'
import type { ChatPresentation, RegionLoader, TurnRegionProps } from '@/sdk/layouts'
import { APPROVAL_ERROR, APPROVAL_PENDING } from '../protocol'
import LazyRegion from '../LazyRegion'
import { LazyBoundary } from '../parts/LazyBoundary'
import type { GateProps } from './decision'
import { pinsGates, pinnedSlotRef, usePinnedSlot } from './pinned'
import { useRegionProps } from './regionState'
import type { ThreadVariant } from './TurnMeta'
import { ComposerModel } from './ComposerModel'
import './composer.css'

const ApprovalCard = lazy(() => import('./ApprovalCard'))
const KeyboardGate = lazy(() => import('./KeyboardGate'))
const TurnMetaLazy = lazy(() => import('./TurnMeta'))
const AsideLazy = lazy(() => import('./Aside'))

const VARIANT_CSS: Record<ThreadVariant, () => Promise<unknown>> = {
  quiet: () => import('./quiet.css'),
  bubbles: () => import('./bubbles.css'),
  steps: () => import('./steps.css'),
  dense: () => import('./dense.css'),
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

/**
 * The layout's approval presentation (`chat.approvals`) for an open gate on
 * a tool part; `children` (the inline gate) for `inline`, while the chunk
 * loads, or if it fails. `description` is the tool row's text (the server's
 * emoji already stripped).
 */
export function Gate({ presentation, part, description, children }: {
  presentation: { chat: ChatPresentation }
  part: ToolCallMessagePartProps
  description?: string
  children: ReactNode
}): JSX.Element {
  const mode = presentation.chat.approvals
  if (mode !== 'card' && mode !== 'keyboard') return <>{children}</>
  const a = (part.artifact ?? {}) as Record<string, unknown>
  const p: GateProps = {
    prompt: part.approval?.prompt ?? `Allow ${part.toolName}?`,
    risk: str(a.risk_level),
    pending: str(a[APPROVAL_PENDING]),
    error: str(a[APPROVAL_ERROR]),
    respond: (approved) => part.respondToApproval({ approved }),
    toolName: part.toolName,
    label: str(a.label),
    description: description || undefined,
    agent: str(a.agent_name),
    args: part.args,
  }
  const C = mode === 'card' ? ApprovalCard : KeyboardGate
  return (
    <PinnedGate presentation={presentation}>
      <LazyBoundary fallback={children} failed={children}>
        <C {...p} />
      </LazyBoundary>
    </PinnedGate>
  )
}

/**
 * An open gate in the 'steps' thread: the turn's steps are the layout's
 * (its turnHeader), so the decision moves out of the turn to just above the
 * composer, where it is seen without scrolling. Elsewhere, or until that
 * place is mounted, it stays in the turn.
 */
function PinnedGate({ presentation, children }: { presentation: { chat: ChatPresentation }; children: ReactNode }): JSX.Element {
  const slot = usePinnedSlot()
  return slot && pinsGates(presentation.chat) ? createPortal(children, slot) : <>{children}</>
}

/**
 * The composer's footer in a layout: the place above the composer that
 * pinned gates go to (nothing for a thread that pins none), and the model
 * button the composer row gets (a portal, drawn after mount).
 */
export function Pinned({ presentation }: { presentation: { chat: ChatPresentation } }): JSX.Element | null {
  return (
    <>
      <ComposerModel />
      {pinsGates(presentation.chat) && (
        <div ref={pinnedSlotRef} className="flex flex-col gap-2 pb-2 empty:hidden" data-chat-pinned aria-label="Waiting for your OK" role="region" />
      )}
    </>
  )
}

/** An empty thread: the layout's `empty` region, else `children` (the starters). */
export function Empty({ presentation, children }: {
  presentation: { chat: ChatPresentation; sessionId: string | null }
  children: ReactNode
}): JSX.Element {
  const { chat, sessionId } = presentation
  return chat.empty ? <Region loader={chat.empty} name="empty" sessionId={sessionId} /> : <>{children}</>
}

/**
 * One assistant turn (`children`) in a layout: the variant's turn header,
 * with `agentLine` (the plain agent name) while it loads or without a
 * variant, and the layout's turnHeader and turnFooter regions. The first
 * turn fetches the variant's stylesheet (scoped to `[data-variant]`, so it
 * is harmless after a layout switch).
 */
export function Turn({ presentation, agentLine, children }: {
  presentation: { chat: ChatPresentation; sessionId: string | null }
  agentLine: ReactNode
  children: ReactNode
}): JSX.Element {
  const { chat, sessionId } = presentation
  const variant = chat.thread
  const messageId = useAuiState((s) => s.message.id)
  useEffect(() => {
    if (variant) void VARIANT_CSS[variant]?.().catch(() => undefined)
  }, [variant])
  return (
    <>
      {variant ? (
        <LazyBoundary fallback={agentLine} failed={agentLine}>
          <TurnMetaLazy variant={variant} />
        </LazyBoundary>
      ) : (
        agentLine
      )}
      {chat.turnHeader && <Region loader={chat.turnHeader} name="turnHeader" sessionId={sessionId} messageId={messageId} />}
      {children}
      {chat.turnFooter && <Region loader={chat.turnFooter} name="turnFooter" sessionId={sessionId} messageId={messageId} />}
    </>
  )
}

/**
 * A layout region with its ChatRegionProps (and the message id for a
 * per-turn region). A turn region's loader is typed for TurnRegionProps.
 */
export function Region({ loader, name, sessionId, messageId }: {
  loader: RegionLoader | RegionLoader<TurnRegionProps>
  name: string
  sessionId: string | null
  messageId?: string
}): JSX.Element {
  const base = useRegionProps(sessionId)
  const props = useMemo(() => (messageId === undefined ? base : { ...base, messageId }), [base, messageId])
  return <LazyRegion loader={loader as RegionLoader} props={props} name={name} />
}

/**
 * The side panel for `chat.aside` (nothing without one), labelled
 * `asideLabel` or "Panel"; nothing while its chunk loads or if it fails.
 * `slot` is where the desktop toggle goes (the chat header).
 */
export function Aside({ presentation, slot }: {
  presentation: { chat: ChatPresentation; sessionId: string | null }
  slot?: HTMLElement | null
}): JSX.Element | null {
  const { chat, sessionId } = presentation
  if (!chat.aside) return null
  return (
    <LazyBoundary failed={null}>
      <AsideLazy loader={chat.aside} label={chat.asideLabel || 'Panel'} sessionId={sessionId} slot={slot} />
    </LazyBoundary>
  )
}
