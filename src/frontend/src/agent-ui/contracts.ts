/**
 * PraisonAIUI Agent-UI contracts
 *
 * Stable, framework-agnostic view models owned by PraisonAIUI. These are the
 * ONLY types that non-adapter code (chat views, dashboards, tests) should
 * depend on. BeautifulUI / vendored component prop types must never leak
 * outside `src/agent-ui/` — the adapter maps to these contracts instead so
 * the upstream implementation can be swapped without touching consumers.
 *
 * See docs/frontend/beautifului-adapter-architecture.md.
 */

/** Discriminant for a normalized agent stream event. */
export type AgentStreamEventKind =
    | 'run-started'
    | 'run-token'
    | 'run-completed'
    | 'run-error'
    | 'tool-call'
    | 'reasoning-step'
    | 'unknown'

/**
 * Normalized agent stream event — the stable shape UI code consumes,
 * decoupled from the raw WebSocket frame `type` strings handled in chat.js.
 */
export interface AgentStreamEvent {
    kind: AgentStreamEventKind
    /** Owning session, when the frame carried one. */
    sessionId?: string
    /** Run identifier, when the frame carried one. */
    runId?: string
    /** Human-facing agent name, when present. */
    agentName?: string
    /** Streaming token or final content, depending on `kind`. */
    text?: string
    /** Populated for `kind === 'tool-call'`. */
    toolCall?: ToolCallChipModel
    /** Populated for `kind === 'run-error'`. */
    error?: string
    /** Raw frame `type` for events we do not yet normalize (`kind === 'unknown'`). */
    rawType?: string
}

/** View model for a tool-call chip, independent of any component library. */
export interface ToolCallChipModel {
    id: string
    label: string
    icon?: string
    stepNumber?: number
    status: 'running' | 'done' | 'error'
    error?: string
}

/** Risk levels surfaced by the approvals REST API (`/api/approvals/*`). */
export type ApprovalRiskLevel = 'low' | 'medium' | 'high' | 'critical'

/** View model for an approval prompt/card, independent of any component library. */
export interface ApprovalPromptModel {
    id: string
    toolName: string
    agentName: string
    riskLevel: ApprovalRiskLevel
    riskIcon: string
    description?: string
    /** Pretty-printed tool arguments, ready for display. */
    argumentsJson: string
    createdAt?: string
}
