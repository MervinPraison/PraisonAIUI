# ADR: BeautifulUI adapter layer & upstream pin policy

**Status:** Accepted · **Issue:** [#294](https://github.com/MervinPraison/PraisonAIUI/issues/294)

## Context

BeautifulUI is **not** a semver npm library — it is distributed as shadcn-style
registry components that are copied into the consuming repo. PraisonAIUI must
integrate it without leaking upstream types or import paths across the codebase,
and without breaking when either side updates.

## Decision

Introduce a single **adapter boundary** between transport payloads and the UI,
and vendor BeautifulUI components behind that boundary.

```
Agent APIs (Python) ──► event bus / WS messages
                              │
                              ▼
                    Agent-UI adapter (src/agent-ui/adapter.ts)
                    (stable PraisonAIUI contracts)
                              │
                              ▼
              @praisonaiui/react re-exports
              (BeautifulUI vendored components)
                              │
                              ▼
         Dashboard / chat mount points (React islands, then full shell)
```

### 1. Folder layout

```
src/frontend/src/agent-ui/
├── contracts.ts        # Stable PraisonAIUI view models (the ONLY types consumers import)
├── adapter.ts          # Pure mappers: wire payload -> contracts
├── adapter.test.ts     # Unit tests (mock events -> props), node:test
├── index.ts            # Barrel: contracts + adapters + (later) vendored re-exports
└── vendors/
    └── beautifului/    # Vendored BeautifulUI components (added during migration)
```

**Rule:** BeautifulUI / upstream prop types must **never** be imported outside
`src/agent-ui/`. Consumers depend on `contracts.ts` only, so the vendored
implementation can be swapped later without touching call sites.

### 2. Adapter contracts

Internal, transport-agnostic types live in `contracts.ts`:

- `AgentStreamEvent` — normalized form of the WebSocket frames handled in
  `chat.js` (`run_started`, `run_content`, `tool_call_started`, …). Unknown
  frame `type`s degrade to `kind: 'unknown'` with `rawType` preserved instead
  of throwing, so new upstream events never break the UI.
- `ToolCallChipModel` — tool-call chip view model.
- `ApprovalPromptModel` — approval card view model, mapped from the
  `/api/approvals/pending` REST payload.

Mappers (`adapter.ts`): `mapChatEventToUi(frame)` and
`mapApprovalToCardProps(item)`. Both are **pure** and unit tested.

### 3. Vendoring & pin policy

| Mechanism | Purpose |
|-----------|---------|
| [`BEAUTIFULUI_UPSTREAM.md`](./BEAUTIFULUI_UPSTREAM.md) | Record git SHA, date, registry base URL for every vendored component |
| shadcn registry URLs | Per-component install, pinned in the upstream doc |
| **No** `dependencies.beautiful-ui` in `package.json` | Avoid a phantom npm package |

**Upgrade rule:** bump upstream **only** via a PR that updates
`BEAUTIFULUI_UPSTREAM.md` and passes the frontend CI gate (issue #295). Icons
stay on `lucide-react`; do not vendor paid Central icons.

### 4. Feature flag (default **off**)

Integration is gated so the existing vanilla-JS chat/approvals plugins remain
the fallback until migration milestones (#296, #297) complete.

- **Flag:** `AIUI_BEAUTIFULUI` (build-time env / dashboard config JSON).
- **Default:** off — vanilla JS renders; the adapter is imported but not mounted.
- **On:** React islands mount using `src/agent-ui` contracts.
- **Fallback:** if a vendored component fails to load, the flag is treated as
  off and the vanilla path renders. No user-facing regression when off.

### 5. Design tokens

Scope agent-UI primitives under an `.aiui-agent-ui { … }` CSS layer (or extend
the existing shadcn presets in `themes.py`) so vendored component tokens cannot
collide with the global dashboard theme.

### 6. Deprecation / upstream abandonment

Vendored code stays MIT-licensed in-tree. Because consumers depend only on the
`contracts.ts` view models, a future first-party implementation can satisfy the
same contracts and replace the vendored components with no call-site churn.

## Consequences

- One place (`src/agent-ui/`) owns the upstream coupling.
- Adapters are testable without a browser or the transport layer.
- The default-off flag keeps the migration reversible at every step.
