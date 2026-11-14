/**
 * The chat's layout presentation host (ADR 0003 §1.3): one lazy chunk the
 * chat page loads only while a layout declares `meta.chat`. It holds the
 * small wrappers the Thread and the page render; each feature behind them
 * is its own lazy chunk again, fetched only when the layout asks for it:
 *
 *   Gate          approvals 'card' (./ApprovalCard) or 'keyboard' (./KeyboardGate)
 *   TurnMeta      the turn header of a thread variant (./TurnMeta), and the
 *                 variant's stylesheet (./quiet.css, ./bubbles.css…)
 *   Region        a layout region (turnHeader, turnFooter, empty) via ../LazyRegion
 *   Aside         the side panel / phone switch for `aside` (./Aside)
 *
 * The state behind them (viewport, the aside badge) lives here too, so the
 * chat route itself carries only the hooks to this module (R10 budget).
 */
import { lazy, useEffect, useMemo, type JSX, type ReactNode } from 'react'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
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
  mode: NonNullable<ChatPresentation['approvals']>
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
 * The turn header of a thread variant; `fallback` (the plain agent line)
 * while it loads. The first one fetches the variant's stylesheet (scoped to
 * `[data-variant]`, so it is harmless after a layout switch).
 */
export function TurnMeta({ variant, fallback }: { variant?: ThreadVariant; fallback: ReactNode }): JSX.Element {
  useEffect(() => {
    if (variant) void VARIANT_CSS[variant]?.().catch(() => undefined)
  }, [variant])
  if (!variant) return <>{fallback}</>
  return (
    <LazyBoundary fallback={fallback} failed={fallback}>
      <TurnMetaLazy variant={variant} />
    </LazyBoundary>
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

/** The layout's turnHeader or turnFooter around one assistant turn (nothing when the layout has none). */
export function TurnRegion({ at, presentation, messageId }: {
  at: 'turnHeader' | 'turnFooter'
  presentation: { chat: ChatPresentation; sessionId: string | null }
  messageId: string
}): JSX.Element | null {
  const loader = presentation.chat[at]
  return loader ? <Region loader={loader} name={at} sessionId={presentation.sessionId} messageId={messageId} /> : null
}

/** The side panel for `aside`; nothing while its chunk loads or if it fails. */
export function Aside(p: ChatAsideProps): JSX.Element {
  return (
    <LazyBoundary failed={null}>
      <AsideLazy {...p} />
    </LazyBoundary>
  )
}
