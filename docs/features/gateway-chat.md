# Gateway Chat

The Chat page of the `dashboard` style (and of the app shell, which hosts the same view): real-time agent chat over a WebSocket, with markdown rendering, tool call cards and session history. The browser side is the vanilla `chat.js` view; the server side is the chat feature (`praisonaiui.features.chat`).

![The chat in the app shell, dark: an agent thought for two seconds, ran python3 --version, answered and now waits for approval to install numpy; the table and script it made sit under the answer](../images/chat-interface.png)

## Quick Start

```python
# app.py
import praisonaiui as aiui

aiui.set_style("dashboard")

@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You said: {message}")
```

```bash
aiui run app.py
# Open http://127.0.0.1:8000 and choose Chat in the sidebar
```

Without a `@aiui.reply` callback the chat runs the configured agents through
the PraisonAI provider (`pip install "aiui[praisonai]"`).

## How It Works

### Full Streaming Data Flow

A chat message travels through 5 layers before reaching the browser:

```mermaid
sequenceDiagram
    participant U as User (Browser)
    participant JS as chat.js
    participant WS as WebSocket /api/chat/ws
    participant CM as ChatManager<br/>(chat.py)
    participant PR as PraisonAIProvider<br/>(providers/__init__.py)
    participant SDK as Agent.chat()<br/>(praisonaiagents)

    U->>JS: User types message, hits Send
    JS->>WS: {type: "chat", content: "Hello"}
    WS->>CM: _run_and_broadcast(session_id, content)
    CM->>PR: provider.run(content, session_id)
    PR->>SDK: agent.chat(message, stream=True)

    rect rgb(40, 40, 60)
    note over SDK,JS: Streaming Phase
    SDK-->>PR: StreamEvent (DELTA_TEXT tokens)
    PR-->>CM: RunEvent(RUN_CONTENT, token="...")
    CM-->>WS: broadcast({type: "run_content", token: "..."})
    JS->>JS: appendDelta(token) — accumulate in single DOM element

    SDK-->>PR: StreamEvent (TOOL_CALL_START)
    PR-->>CM: RunEvent(TOOL_CALL_STARTED, name, args)
    CM->>CM: Dedup + enrich (icon, description, step_number)
    CM-->>WS: broadcast({type: "tool_call_started", ...enriched})
    JS->>JS: appendToolCall(data, 'running') — collapsible card

    SDK-->>PR: StreamEvent (TOOL_CALL_END + result)
    PR-->>CM: RunEvent(TOOL_CALL_COMPLETED, result)
    CM->>CM: Merge result into collected_tool_calls
    CM-->>WS: broadcast({type: "tool_call_completed", ...enriched})
    JS->>JS: updateToolCall(data, 'done') — show ✓ + result

    SDK-->>PR: StreamEvent (STREAM_END)
    PR-->>CM: RunEvent(RUN_COMPLETED, content=str(response))
    CM-->>WS: broadcast({type: "run_completed", content: "..."})
    JS->>JS: finalizeDelta(content) — replace streaming text with final
    end

    rect rgb(40, 50, 40)
    note over CM: Persistence Phase
    CM->>CM: Save to datastore: {role, content, toolCalls}
    end
```

### Key Files

| File | Layer | Responsibility |
|------|-------|----------------|
| `src/praisonaiui/templates/frontend/plugins/views/chat.js` | Frontend | WS connection, DOM rendering, session history |
| `src/praisonaiui/features/chat.py` | Backend | ChatManager, `_run_and_broadcast`, history API |
| `src/praisonaiui/server.py` | Backend | SSE streaming path (`run_agent` endpoint) |
| `src/praisonaiui/providers/__init__.py` | Provider | SDK → RunEvent bridge, `_run_direct_mode` |
| `src/praisonaiui/datastore.py` | Storage | `MemoryDataStore` / `JSONFileDataStore` |
| `src/praisonaiui/provider.py` | Protocol | `RunEventType` enum definition |

## Architecture

```mermaid
graph TD
    A["ChatProtocol (ABC)"] --> B["ChatManager (Default)"]
    B --> C["send_message()"]
    B --> D["get_history()"]
    B --> E["abort_run()"]
    B --> F["broadcast()"]
    G["ChatFeature"] --> H["API Routes"]
    H --> I["POST /api/chat/send"]
    H --> J["GET /api/chat/history/{session_id}"]
    H --> K["POST /api/chat/abort"]
    H --> M["GET /api/chat/context-stats"]
    H --> L["WS /api/chat/ws"]
```

## Agent Tool Resolution

Agents created via YAML config, CRUD API, jobs, or channel bots automatically get tools resolved through the `ToolResolver`. Tool names in config are resolved to callable Python functions from 4 sources:

1. Local `tools.py` file (backward compatibility)
2. `praisonaiagents.tools.TOOL_MAPPINGS` (built-in tools)
3. `praisonai_tools` package (community tools)
4. Tool registry (programmatically registered tools)

### YAML Configuration

```yaml
# ~/.praisonaiui/config.yaml (unified runtime config)
agents:
  researcher:
    instructions: "Research topics thoroughly."
    model: gpt-4o-mini
    tools:
      - internet_search        # Resolved to callable function
      - wikipedia_search
    reflection: true            # Enable self-reflection (default: true)
    role: "Senior Researcher"   # Optional CrewAI-style params
    goal: "Find accurate info"
    backstory: "Expert researcher"
```

### CRUD API

Agents created via `POST /api/agents` also support tools:

```json
{
  "name": "researcher",
  "instructions": "Research topics thoroughly.",
  "model": "gpt-4o-mini",
  "tools": ["internet_search"],
  "reflection": true
}
```

### Where Tool Resolution Applies

| Component | Tool Resolution |
|-----------|----------------|
| Gateway `_create_agents_from_config()` | ✅ `ToolResolver` |
| Integration `create_gateway_from_yaml()` | ✅ `ToolResolver` |
| Provider `_get_or_create_agent()` | ✅ Default tools |
| Channel bot `_start_channel_bot()` | ✅ Default tools |
| Jobs `_execute_job()` fallback | ✅ `ToolResolver` |
| CRUD agents `_run()` fallback | ✅ `ToolResolver` |
| CRUD agents `_sync_to_gateway()` | ✅ `ToolResolver` |

## Features

### Markdown Rendering

Assistant messages are rendered with full markdown support:

- **Bold**, *italic*, ~~strikethrough~~
- Inline `code` and fenced code blocks with syntax highlighting
- Ordered and unordered lists
- Links (auto-detected and rendered safely)

### Tool Call Display

![A tool call row (execute_command, Done in 0.3 s) above the answer, then an approval card for pip install numpy with Approve and Deny](../images/tool-streaming.png)

When agents use tools, each call is displayed as a collapsible card:

- Tool name and status indicator (running/completed/failed)
- Input arguments (JSON)
- Output results (rendered in code blocks)

#### Tool Call Lifecycle

Tool calls go through 4 stages: **emit → enrich → dedup → persist**.

**1. Emit** — The SDK fires `TOOL_CALL_START` / `DELTA_TOOL_CALL` / `TOOL_CALL_END` events via `StreamEventEmitter`. The provider maps these to `RunEvent` types (`TOOL_CALL_STARTED`, `TOOL_CALL_COMPLETED`).

**2. Enrich** — `_run_and_broadcast()` in `chat.py` enriches each tool call event with display-friendly fields via `_enrich_tool_payload()`:

| Field | Source | Example |
|-------|--------|---------|
| `icon` | Mapped from tool name | 🔍, 📝, 💾 |
| `description` | Generated from name + args | "🔍 Searching for 'Django latest version'" |
| `step_number` | Auto-incrementing counter per run | 1, 2, 3 |
| `formatted_result` | Truncated result string | "✓ Done" |
| `tool_call_id` | SDK-assigned or UUID fallback | "call_abc123" |

**3. Dedup** — Both `DELTA_TOOL_CALL` (stream) and hook callbacks fire for the same tool call. The handler uses `_seen_tool_started` / `_seen_tool_completed` sets keyed by `tool_call_id` and `name` to suppress duplicates. A re-broadcast with `has_complete_args=True` is allowed to update the description with keyword-rich text.

**4. Persist** — After the run completes, all enriched tool calls are merged by `tool_call_id` into `collected_tool_calls` and saved alongside the assistant message:

```python
msg_data = {
    "role": "assistant",
    "content": full_response,
}
if collected_tool_calls:
    msg_data["toolCalls"] = list(collected_tool_calls.values())
await _datastore.add_message(session_id, msg_data)
```

#### Turn order

A reply is saved when its run ends, so two runs in one session (a second tab,
or a question sent after a reload while the first reply is still running)
finish out of order. A user message carries a `turn_id` and its reply a
`reply_to` with the same value; `GET /api/chat/history/{id}` lists each reply
right after its own question. History saved before these fields existed is
shown in the order it was saved.

#### Tool Call Persistence Schema

Tool calls are persisted alongside assistant messages in the datastore. When a session is reloaded from history, tool call steps are reconstructed from the `toolCalls` array on each assistant message.

Assistant message schema in the datastore:

```json
{
  "role": "assistant",
  "content": "Final response text",
  "toolCalls": [
    {
      "name": "search_web",
      "description": "🔍 Searching for 'Django latest version'",
      "icon": "🔍",
      "step_number": 1,
      "args": {"query": "Django latest version"},
      "result": "...",
      "formatted_result": "✓ Done",
      "status": "done",
      "tool_call_id": "tc_abc123",
      "type": "tool_call_completed"
    }
  ]
}
```

#### History Reload Rendering

```mermaid
sequenceDiagram
    participant Browser as chat.js
    participant API as GET /api/chat/history/{id}
    participant DS as DataStore

    Browser->>API: fetch('/api/chat/history/' + sessionId)
    API->>DS: get_messages(session_id)
    DS-->>API: messages (with toolCalls on assistant msgs)
    API-->>Browser: {messages: [...]}
    
    loop forEach message
        alt role == assistant
            Browser->>Browser: appendMessage('assistant', content)
            loop forEach toolCalls[]
                Browser->>Browser: appendToolCall(tc)
                Browser->>Browser: updateToolCall(tc, result)
            end
        else role == user
            Browser->>Browser: appendMessage('user', content)
        end
    end
```

### Session Management

- **New Session**: Click "New Chat" to create a fresh session
- **Session History**: Switch between sessions in the sidebar
- **Message History**: Full conversation history per session via REST API

### Message Abort

- Click the **Stop** button (or send `chat_abort` with the `run_id` over the WebSocket) to cancel a run
- Only the connection that started a run may stop it or answer its prompts (or any client, once that connection is gone)
- The partial response is preserved in history

### File Attachments

Upload files to include with your chat messages — see [Attachments](attachments.md) for details.

## Session Persistence

Chat history is stored through the `BaseDataStore` interface: by default the
praisonaiagents session store, or JSON files, memory or SQL with
`aiui run --datastore`. See [Session Management](sessions.md#data-persistence-options).
Each stored session holds its messages, with `toolCalls` on assistant messages:

```json
{
  "id": "session-uuid",
  "title": "Auto-generated from first user message",
  "created_at": "2026-03-17T08:00:00Z",
  "updated_at": "2026-03-17T08:01:00Z",
  "messages": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "...", "toolCalls": [...]}
  ]
}
```

### Response Content Strategy

The `content` field on assistant messages stores the SDK's final response from `agent.chat()` — the same text displayed by `finalizeDelta()` in the live view. This ensures the reloaded view matches what the user saw during streaming.

!!! important
    During streaming, text tokens are accumulated in `full_response`. When `RUN_COMPLETED` arrives with `event.content` (the SDK's authoritative return value), it **replaces** the accumulated tokens for storage. This prevents intermediate narrative text from being duplicated on reload.

## Chat Message Model

```python
@dataclass
class ChatMessage:
    role: str                          # "user" | "assistant" | "system" | "tool"
    content: str                       # Message text
    session_id: str                    # Session identifier
    message_id: str                    # Auto-generated UUID
    agent_name: Optional[str] = None   # Agent name
    timestamp: float                   # Unix timestamp
    metadata: Optional[Dict] = None    # Tool calls and other metadata
```

## WebSocket Protocol

On a server with auth on, the browser first exchanges its key for a
single-use ticket (`POST /api/auth/ws-ticket`) and connects with `?ticket=`;
see [Deployment](deployment.md).

### Client → Server

```json
// Send a message (optional: agent_name, attachment_ids, client_turn_id, regenerate)
{"type": "chat", "content": "Hello!", "session_id": "abc-123"}

// Abort a run: answered with {"type": "chat_abort_result", "status": ..., "run_id": ...}
{"type": "chat_abort", "run_id": "run-1"}

// Answer an agent's question: answered with {"type": "ask_response_ack", "status": ...},
// status "received", "no_pending_ask" (nothing was waiting: the ask timed out or
// the run ended) or "forbidden" (another connection's run)
{"type": "ask_response", "session_id": "abc-123", "run_id": "run-1", "response": "5.1"}

// Is a run still active?
{"type": "run_status", "run_id": "run-1"}

// Receive only these sessions' events (default: every session)
{"type": "subscribe", "session_ids": ["abc-123"]}
{"type": "unsubscribe", "session_ids": ["abc-123"]}

// Keepalive ping
{"type": "ping"}
```

A frame that is not a JSON object is answered with
`{"type": "protocol_error", "error": ...}`; the connection stays open.

### Server → Client

All events include `session_id` and `run_id`.

```json
// Streaming text token
{"type": "run_content", "token": "Hello", "session_id": "...", "run_id": "..."}

// Tool call started (enriched)
{
  "type": "tool_call_started",
  "name": "search_web",
  "tool_call_id": "call_abc123",
  "args": {"query": "Django"},
  "description": "🔍 Searching for 'Django'",
  "icon": "🔍",
  "step_number": 1
}

// Tool call completed (enriched)
{
  "type": "tool_call_completed",
  "tool_call_id": "call_abc123",
  "name": "search_web",
  "result": "Django 5.1 released...",
  "formatted_result": "✓ Done",
  "status": "done"
}

// Intermediate LLM narrative text (between tool calls)
{"type": "llm_content", "content": "Let me search for that..."}

// Reasoning step (thinking)
{"type": "reasoning_step", "step": "Analyzing the query..."}

// Agent asks for user input
{"type": "run_paused", "question": "Which version?", "options": ["5.0", "5.1"]}

// Memory updates
{"type": "memory_update_started"}
{"type": "updating_memory"}
{"type": "memory_update_completed"}

// Run completed (content = SDK's final response)
{"type": "run_completed", "content": "Here are the results..."}

// Error / Cancel
{"type": "run_error", "error": "..."}
{"type": "run_cancelled"}

// Team variants (multi-agent)
{"type": "team_run_started", "agent_name": "researcher"}
{"type": "team_run_content", "token": "..."}
{"type": "team_tool_call_started", ...}
{"type": "team_tool_call_completed", ...}
{"type": "team_run_completed", "content": "..."}

// Channel bot messages
{"type": "channel_message", "platform": "slack", "sender": "User", "content": "..."}
{"type": "channel_response", "platform": "slack", "content": "..."}

// Keepalive
{"type": "pong"}
```

## REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat/send` | POST | Start a run; the reply streams to WebSocket clients |
| `/api/chat/history/{session_id}` | GET | Get message history for a session |
| `/api/chat/abort` | POST | Abort an active run (`{"run_id": ...}`) |
| `/api/chat/context-stats` | GET | Context-window usage for a session |
| `/api/chat/ws` | WebSocket | Real-time chat streaming |

### Send Message

```bash
curl -X POST http://localhost:8000/api/chat/send \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello!", "session_id": "my-session"}'
```

### Get History

```bash
curl http://localhost:8000/api/chat/history/my-session
```

Response includes `toolCalls` on assistant messages:

```json
{
  "messages": [
    {"role": "user", "content": "Search for Django"},
    {
      "role": "assistant",
      "content": "Here are the results...",
      "toolCalls": [
        {
          "name": "search_web",
          "description": "🔍 Searching for 'Django'",
          "step_number": 1,
          "status": "done",
          "result": "..."
        }
      ]
    }
  ]
}
```

## Frontend (chat.js)

The chat frontend is a vanilla JavaScript view,
`src/praisonaiui/templates/frontend/plugins/views/chat.js`, shipped as-is with
the package (it is not generated by the frontend build).

### Core Functions

| Function | Purpose |
|----------|--------|
| `connectWebSocket()` | Open the WS (with a ticket when auth is on); reconnects on close |
| `handleWsMessage(data)` | Event dispatch — routes to rendering functions |
| `appendMessage(role, content, agentName)` | Render a complete message (history load) |
| `appendDelta(token, agentName)` | Streaming — append token to `currentDeltaEl` |
| `finalizeDelta(content, agentName)` | End streaming — replace with final content |
| `appendToolCall(data, status)` | Render tool call card |
| `updateToolCall(data, status)` | Update card with result |
| `appendReasoning(step)` | Render thinking step |
| `appendAskWidget(question, options, sessionId, runId)` | Render user-input prompt |
| `appendMemoryIndicator(text)` | Show memory update spinner |
| `loadSession(sessionId)` | Fetch history → render messages + tool calls |
| `restoreSessionHistory(sessionId)` | Same as above, on WS reconnect |
| `renderMarkdown(text)` | Custom zero-dependency markdown renderer |
| `escapeHtml(str)` | XSS prevention sanitizer |

### Streaming Text Model

During streaming, **all text tokens go into a single `currentDeltaEl` DOM element** — even across tool call boundaries. Tool call cards are sibling elements inserted alongside the text element. When `run_completed` arrives, `finalizeDelta(content)` **replaces** the accumulated text with the SDK's final response.

## Theming

The chat UI supports dark and light themes via CSS custom properties — see [Theme System](theme-system.md).

## Related

- [Attachments](attachments.md) — File uploads in chat
- [Theme System](theme-system.md) — Dark/light mode
- [Protocol Versioning](protocol-versioning.md) — WebSocket protocol negotiation
- [Subagent Tree](subagent-tree.md) — Agent hierarchy visualization
