---
description: PraisonAIUI product categories and differentiation
---

# UI Product Categories

PraisonAIUI supports three distinct styles, each serving a different use case:

## 1. Chat (`style: chat`)
- Full-screen conversational interface (like ChatGPT)
- Sidebar with session/conversation history
- Streaming responses, thinking indicators, tool calls
- Best for: single-agent chat, customer support, Q&A bots

## 2. Playground (`style: playground`)
- Input/output panel layout
- Agent selection, model switching, endpoint configuration
- Session management with agent profiles
- Best for: multi-agent experimentation, developer testing, agent debugging

## 3. UI Components (Widget mode)
- Embeddable components (copilot widget, sidebar panel, floating button)
- Integrates into existing apps/docs sites
- Configurable position: bottom-right, bottom-left, top-right, top-left
- Best for: adding AI to existing products, documentation copilots

## Key Differentiators
- **Chat** = conversation-first, full-page, session history
- **Playground** = multi-agent, experimentation, side-by-side panels
- **Components** = embeddable widgets for existing apps


When using AI, we mainly and primarily use PraisonAI as the backend ~/praisonai-package
When using Platform, we mainly and primarily use PraisonAI (Gateway) as the backend ~/praisonai-package
We will also support other providers, but PraisonAI will be the primary.
PraisonAI already has memory, knowledge, session management, and more. So where possible we will use PraisonAI's features.

## PraisonAI Backend Capabilities (~/praisonai-package)

The backend (`praisonaiagents`) already provides these features. The UI's job is to surface them:

- **Gateway**: EventType enum (20 types), GatewayEvent, GatewayMessage, GatewaySessionProtocol, GatewayClientProtocol
- **Streaming**: StreamEventType (REQUEST_START, FIRST_TOKEN, DELTA_TEXT, DELTA_TOOL_CALL, TOOL_CALL_END, STREAM_END, ERROR), StreamEvent, StreamMetrics, StreamEventEmitter
- **Memory**: Short-term, long-term, user-specific, auto-memory, file memory, rules, workflows (76KB+ implementation)
- **Knowledge**: RAG, vector store, chunking, query engine, rerankers, readers (41KB+ knowledge.py)
- **Sessions**: Full Session API with state persistence, agent chat history, memory/knowledge integration
- **Hooks**: Registry, middleware, runner, events, types (65KB+ system)
- **Approval**: Full human-in-the-loop approval with backends, registry, protocols
- **Bots/Channels**: Telegram (via gateway.yaml channel routing), extensible to Slack/Discord/WhatsApp etc. (Via Gateway)
- **Other**: MCP, guardrails, planning, sandbox, plugins, tools, thinking, escalation, checkpoints

## Goal of PraisonAIUI

One of the primary goals is: **make the web UI enable and surface these existing PraisonAI backend features**.
Except for the web UI itself, PraisonAI supports everything. This project fills that gap.

## Provider Protocol Architecture (Extensibility)

PraisonAIUI is **provider-agnostic**. The architecture uses a protocol-driven design so any AI backend can be swapped in:

- **`BaseProvider`** (`src/praisonaiui/provider.py`): Abstract base class any backend implements. Only `run()` is required — yields `RunEvent` objects.
- **`RunEvent`**: Structured dataclass with `type` (27 `RunEventType` values), optional fields for content, tool calls, reasoning, errors, agent info, and arbitrary `extra_data`.
- **`PraisonAIProvider`** (`src/praisonaiui/providers/__init__.py`): Default implementation wrapping the `@aiui.reply` callback system. Maps legacy queue events to `RunEvent`.

### Swapping Providers

```python
import praisonaiui

# Use any custom provider:
praisonaiui.set_provider(MyLangChainProvider())
# or
praisonaiui.set_provider(MyCrewAIProvider())
```

### Design Principles
- **Protocol-first**: All communication between UI and backend goes through `RunEvent` protocol — no tight coupling
- **PraisonAI primary, others welcome**: PraisonAI is the default, but the architecture doesn't lock you in
- **Frontend already ready**: The frontend `useSSE.ts` hook and components (`ToolCallDisplay`, `ThinkingSteps`, `MultimediaElements`) already handle all 27 `RunEventType` values — swapping the backend requires no frontend changes

Aim is by default it need to be protocol driven, so we can easily extend, or replace any providers or function accordingly. At the same time it also need to be capable of handling clients, and the clients will be of config driven, same like chainlit or yaml config and it should work. 