/**
 * The chat's layout presentation host (ADR 0003 §1.3): one lazy chunk the
 * chat page loads only while a layout declares `meta.chat`. It holds the
 * small wrappers the Thread and the page render; each feature behind them
 * is its own lazy chunk again, fetched only when the layout asks for it:
 *
 *   Gate          approvals 'card' (./ApprovalCard) or 'keyboard' (./KeyboardGate)
 *   Turn          one assistant turn: the variant's turn header (./TurnMeta)
 *                 and stylesheet (./quiet.css, ./bubbles.css…), and the
 *                 layout's turnHeader / turnFooter regions around it
 *   Region        a layout region (turnHeader, turnFooter, empty) via ../LazyRegion
 *   Aside         the side panel / phone switch for `aside` (./Aside)
 *
 * The state behind them (viewport, the aside badge) is in ./regionState.
 * Keeping all of it out of the chat route leaves that route's budget
 * (R10) to the chat itself: it carries only the calls into this module.
 */
import { lazy, useEffect, useMemo, type JSX, type ReactNode } from 'react'
import { useAuiState, type ToolCallMessagePartProps } from '@assistant-ui/react'
import type { ChatPresentation, RegionLoader, TurnRegionProps } from '@/sdk/layouts'
import { APPROVAL_ERROR, APPROVAL_PENDING } from '../protocol'
import LazyRegion from '../LazyRegion'
import { LazyBoundary } from '../parts/LazyBoundary'
import type { ChatAsideProps } from './Aside'
import type { GateProps } from './decision'
import { useRegionProps } from './regionState'
import type { ThreadVariant } from './TurnMeta'

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
 * The layout's approval presentation for an open gate on a tool part;
 * `fallback` (the inline gate) for `inline`, while the chunk loads, or if it
 * fails. `description` is the tool row's text (the server's emoji already
 * stripped).
 */
export function Gate({ mode, part, description, fallback }: {
  mode?: ChatPresentation['approvals']
  part: ToolCallMessagePartProps
  description?: string
  fallback: ReactNode
}): JSX.Element {
  if (mode !== 'card' && mode !== 'keyboard') return <>{fallback}</>
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
    <LazyBoundary fallback={fallback} failed={fallback}>
      <C {...p} />
    </LazyBoundary>
  )
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

/** The side panel for `aside`; nothing while its chunk loads or if it fails. */
export function Aside(p: ChatAsideProps): JSX.Element {
  return (
    <LazyBoundary failed={null}>
      <AsideLazy {...p} />
    </LazyBoundary>
  )
}
