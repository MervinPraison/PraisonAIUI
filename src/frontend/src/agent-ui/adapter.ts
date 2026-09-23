/**
 * PraisonAIUI Agent-UI adapter
 *
 * Pure mapping functions from wire payloads to stable PraisonAIUI contracts.
 * This is the single boundary between transport shapes (WebSocket frames from
 * chat.js, REST payloads from /api/approvals/*) and the UI layer. Vendored
 * BeautifulUI components are rendered from these contracts elsewhere in
 * `src/agent-ui/`; consumers never import upstream prop types directly.
 *
 * Functions are intentionally side-effect free so they can be unit tested
 * with mock events (see adapter.test.ts).
 */

import type {
    AgentStreamEvent,
    ApprovalPromptModel,
    ApprovalRiskLevel,
    ToolCallChipModel,
} from './contracts'

/** Raw WebSocket frame as parsed in chat.js (`JSON.parse(event.data)`). */
export type RawChatFrame = Record<string, unknown>

/** Raw approval item as returned by `/api/approvals/pending`. */
export type RawApprovalItem = Record<string, unknown>

const VALID_RISK_LEVELS: readonly ApprovalRiskLevel[] = [
    'low',
    'medium',
    'high',
    'critical',
]

function asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined
}

/**
 * Normalize a `created_at` value to an ISO-8601 string. The approvals API
 * emits epoch seconds (`time.time()`), while some payloads already carry an
 * ISO string — accept both, drop anything else.
 */
function asTimestamp(value: unknown): string | undefined {
    if (typeof value === 'string') return value
    if (typeof value === 'number' && Number.isFinite(value)) {
        return new Date(value * 1000).toISOString()
    }
    return undefined
}

/** Map a raw tool-call frame to a stable chip view model. */
function mapToolCall(
    frame: RawChatFrame,
    status: ToolCallChipModel['status'],
): ToolCallChipModel {
    const name = asString(frame.name) ?? 'tool'
    return {
        id: asString(frame.tool_call_id) ?? name,
        label: asString(frame.description) ?? name,
        icon: asString(frame.icon),
        stepNumber: asNumber(frame.step_number),
        status,
        error: asString(frame.error),
    }
}

/**
 * Map a raw WebSocket chat frame to a normalized {@link AgentStreamEvent}.
 *
 * Unknown frame types are preserved as `kind: 'unknown'` with `rawType` set,
 * so new upstream event types degrade gracefully instead of throwing.
 */
export function mapChatEventToUi(frame: RawChatFrame): AgentStreamEvent {
    const rawType = asString(frame.type)
    const sessionId = asString(frame.session_id)
    const runId = asString(frame.run_id)
    const agentName = asString(frame.agent_name)

    switch (rawType) {
        case 'run_started':
            return { kind: 'run-started', sessionId, runId, agentName }
        case 'run_content':
        case 'team_run_content':
            return {
                kind: 'run-token',
                sessionId,
                runId,
                agentName,
                text: asString(frame.token),
            }
        case 'run_completed':
        case 'team_run_completed':
            return {
                kind: 'run-completed',
                sessionId,
                runId,
                agentName,
                text: asString(frame.content),
            }
        case 'run_error':
        case 'team_run_error':
            return {
                kind: 'run-error',
                sessionId,
                runId,
                agentName,
                error: asString(frame.error) ?? 'Unknown error',
            }
        case 'tool_call_started':
        case 'team_tool_call_started':
            return {
                kind: 'tool-call',
                sessionId,
                runId,
                agentName,
                toolCall: mapToolCall(frame, 'running'),
            }
        case 'tool_call_completed':
        case 'team_tool_call_completed':
            return {
                kind: 'tool-call',
                sessionId,
                runId,
                agentName,
                toolCall: mapToolCall(frame, 'done'),
            }
        case 'reasoning_step':
        case 'team_reasoning_step':
            return {
                kind: 'reasoning-step',
                sessionId,
                runId,
                agentName,
                text: asString(frame.step),
            }
        default:
            return { kind: 'unknown', sessionId, runId, agentName, rawType }
    }
}

function normalizeRisk(value: unknown): ApprovalRiskLevel {
    return VALID_RISK_LEVELS.includes(value as ApprovalRiskLevel)
        ? (value as ApprovalRiskLevel)
        : 'medium'
}

/**
 * Map a raw approval item from `/api/approvals/pending` to a stable
 * {@link ApprovalPromptModel}. Arguments are pretty-printed for display and
 * an unknown/missing risk level falls back to `medium`.
 */
export function mapApprovalToCardProps(
    item: RawApprovalItem,
): ApprovalPromptModel {
    let argumentsJson = '{}'
    try {
        argumentsJson = JSON.stringify(item.arguments ?? {}, null, 2)
    } catch {
        // Circular or non-serializable args — degrade to empty object.
        argumentsJson = '{}'
    }

    return {
        id: asString(item.id) ?? '',
        toolName: asString(item.tool_name) ?? 'unknown',
        agentName: asString(item.agent_name) ?? 'Unknown',
        riskLevel: normalizeRisk(item.risk_level),
        riskIcon: asString(item.risk_icon) ?? '⚠️',
        description: asString(item.description),
        argumentsJson,
        createdAt: asTimestamp(item.created_at),
    }
}
