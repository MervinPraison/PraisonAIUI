/**
 * Agent-UI boundary barrel.
 *
 * Consumers import PraisonAIUI's stable agent-UI contracts and adapters from
 * here. Vendored BeautifulUI components live under `src/agent-ui/vendors/` and
 * are re-exported from this folder only — no upstream prop types should be
 * imported outside `src/agent-ui/`.
 */

export type {
    AgentStreamEvent,
    AgentStreamEventKind,
    ApprovalPromptModel,
    ApprovalRiskLevel,
    ToolCallChipModel,
} from './contracts'

export type { RawApprovalItem, RawChatFrame } from './adapter'
export { mapApprovalToCardProps, mapChatEventToUi } from './adapter'
