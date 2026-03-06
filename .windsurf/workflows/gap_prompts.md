---
description: Gap Implementation Prompts — Sequential agent tasks for PraisonAIUI feature gaps
---

# Gap Implementation Prompts

Execute these prompts **sequentially**, one at a time. Each prompt is self-contained with context, analysis steps, and implementation instructions. Complete one fully (analysis → implementation → verification) before starting the next.

Reference: gap_analysis.md in the project's brain directory for full context.

---
---

## PROMPT 1: Channel Management Tab (G1 — Phase 1, Critical)

You are an expert AI engineer. Your task: **Add a Channel Management dashboard tab to PraisonAIUI** that surfaces the existing bot channel infrastructure from the PraisonAI package.

### Context

PraisonAI package already has a full channel/bot system:
- **Bots directory**: `~/praisonai-package/src/praisonai/praisonai/bots/` (26 files)
  - Discord bot: `discord.py`, `_discord_approval.py`
  - Slack bot: `slack.py`, `_slack_approval.py`
  - Telegram bot: `telegram.py`, `_telegram_approval.py`
  - WhatsApp bot: `whatsapp.py`, `_whatsapp_web_adapter.py`
  - Base infra: `bot.py`, `_session.py`, `_rate_limit.py`, `_resilience.py`, `_approval.py`, `_approval_base.py`, `_http_approval.py`, `_webhook_approval.py`, `media.py`, `_commands.py`, `_debounce.py`, `_ack.py`, `_chunk.py`, `_protocol_mixin.py`, `_config_schema.py`, `_registry.py`
- **Gateway**: `~/praisonai-package/src/praisonai/praisonai/gateway/server.py` (1102 lines, 41KB)
  - `WebSocketGateway.health()` — returns per-channel bot health status
  - `WebSocketGateway.start_channels(channels_cfg)` — starts bot instances from config
  - `WebSocketGateway._create_bot(channel_type, token, agent, config, ch_cfg)` — creates bot per channel
  - `WebSocketGateway._run_bot_safe(name, bot)` — runs with error isolation
  - `WebSocketGateway._inject_routing_handler(channel_name, bot)` — routing-aware handlers

PraisonAIUI server: `~/PraisonAIUI/src/praisonaiui/server.py` — Starlette app with SSE streaming, existing dashboard tabs via `/api/*` endpoints and `@page()` decorator.

PraisonAIUI frontend dashboard: `~/PraisonAIUI/src/praisonaiui/templates/frontend/plugins/` — JavaScript plugins for dashboard tabs (e.g., `topnav.js` for tab rendering).

### PHASE 1 — Analysis (MUST complete before implementing)

1. **Inventory the bot system**: Read every file in `~/praisonai-package/src/praisonai/praisonai/bots/`. Understand:
   - How each bot is initialized (constructor params, tokens, agent binding)
   - What status/health information each bot exposes
   - How `_resilience.py` tracks bot health
   - How `_config_schema.py` defines channel configuration
   - How `_registry.py` registers available channels

2. **Inventory the gateway**: Read `~/praisonai-package/src/praisonai/praisonai/gateway/server.py`. Understand:
   - `WebSocketGateway.health()` — what data it returns about channels
   - `start_channels()` — how channels are started from YAML config
   - `_create_bot()` — bot factory pattern
   - Channel routing: `_determine_routing_context()`, `_resolve_agent_for_message()`

3. **Inventory PraisonAIUI dashboard**: Read `~/PraisonAIUI/src/praisonaiui/server.py`. Understand:
   - How existing `/api/*` endpoints work (pattern for adding new ones)
   - How `@page()` decorator registers dashboard pages
   - How `_registered_pages` dict works
   - How dashboard tabs are rendered in the frontend

4. **Inventory the frontend**: Read `~/PraisonAIUI/src/praisonaiui/templates/frontend/plugins/topnav.js` and other dashboard plugins. Understand:
   - How tabs are dynamically rendered
   - How tab data is fetched from `/api/*` endpoints
   - The pattern for adding a new dashboard tab

5. **Gap Analysis**: Document exactly what's missing:
   - Backend: API endpoint to query channel status
   - Frontend: Dashboard tab component for channels
   - Integration: How PraisonAIUI will communicate with the gateway for channel health

6. **Plan**: Produce a step-by-step implementation plan listing exact files to create/modify.

### PHASE 2 — Implementation (MUST)

1. **Backend — Add `/api/channels` endpoint** in `~/PraisonAIUI/src/praisonaiui/server.py`:
   - `GET /api/channels` — Returns list of configured channels with status (name, type, health, connected, last_active)
   - `POST /api/channels/{name}/restart` — Restart a specific channel bot
   - The endpoint should integrate with the gateway's `health()` method or maintain its own channel registry
   - Follow the exact pattern of existing `/api/overview`, `/api/config` endpoints

2. **Frontend — Add Channels dashboard page**:
   - Create a new dashboard plugin or add to existing dashboard rendering
   - Show a card/table for each channel: icon, name, status (online/offline/error), message count, last activity
   - Add status indicators (green/yellow/red dots)
   - Add restart button per channel
   - Follow the existing dashboard tab rendering pattern from `topnav.js`

3. **Register the tab**: Ensure the Channels tab appears in the dashboard navigation alongside existing tabs (Agents, Config, Logs)

### PHASE 3 — Verification (MUST)

1. Run the PraisonAIUI dev server and verify the Channels tab appears
2. Verify `/api/channels` returns correct data
3. Verify the UI renders channel cards with accurate status
4. Test with at least one bot configured and verify status updates
5. Verify no regressions in existing dashboard tabs
6. Document what was implemented and what remains

---
---

## PROMPT 2: Scheduler/Cron Tab (G2 — Phase 1, Critical)

You are an expert AI engineer. Your task: **Add a Scheduler dashboard tab to PraisonAIUI** that surfaces the existing AgentScheduler from the PraisonAI package.

### Context

PraisonAI package has a complete scheduler system:
- **Scheduler directory**: `~/praisonai-package/src/praisonai/praisonai/scheduler/` (7 files)
  - `agent_scheduler.py` (21KB) — `AgentScheduler` class:
    - `__init__(agent, task, config, on_success, on_failure, timeout, max_cost)` 
    - `start(schedule_expr, max_retries, run_immediately)` — schedule expressions: `"hourly"`, `"daily"`, `"*/6h"`, `"3600"` (seconds)
    - `stop()` — graceful shutdown
    - `get_stats()` — execution stats including cost
    - `execute_once()` — one-time run
    - `from_yaml(yaml_path, ...)` — create from agents.yaml
    - `from_recipe(recipe_name, ...)` — create from recipe
    - `start_from_yaml_config()` — start using YAML schedule config
  - `daemon_manager.py` (7KB) — background process lifecycle
  - `state_manager.py` (4KB) — persistent execution state
  - `base.py` (4KB) — `ScheduleParser`, `PraisonAgentExecutor` base classes
  - `yaml_loader.py` (6KB) — YAML schedule config loading
- **Top-level**: `~/praisonai-package/src/praisonai/praisonai/agent_scheduler.py` (11KB) — convenience wrapper

PraisonAIUI: `~/PraisonAIUI/src/praisonaiui/server.py` — Starlette app. Existing pattern: API endpoints return JSON, dashboard renders tabs.

### PHASE 1 — Analysis (MUST complete before implementing)

1. **Read the full scheduler system**: Go through every file in `~/praisonai-package/src/praisonai/praisonai/scheduler/`:
   - `agent_scheduler.py` — understand the full `AgentScheduler` lifecycle (init → start → _run_schedule → _execute_with_retry → stop)
   - `base.py` — understand `ScheduleParser.parse()` for schedule expression formats
   - `daemon_manager.py` — understand how daemon processes are managed (start/stop/status)
   - `state_manager.py` — understand how execution state is persisted (where, format)
   - `yaml_loader.py` — understand YAML config format for schedules

2. **Understand the data model**: What data does a scheduled agent have?
   - Schedule expression, agent identity, task description, max retries, timeout, max cost
   - Execution stats: total_runs, successful_runs, failed_runs, total_cost, last_run, next_run

3. **Inventory PraisonAIUI**: Read `server.py` to understand the pattern for adding CRUD API endpoints.

4. **Gap Analysis**: Document exactly what's needed:
   - API: CRUD endpoints for schedules (list, create, update, delete, run-now, get-stats)
   - Storage: Where to persist schedule definitions (YAML file? database? in-memory?)
   - Frontend: Scheduler tab with schedule list, create/edit form, run history

5. **Plan**: Step-by-step with exact files to create/modify.

### PHASE 2 — Implementation (MUST)

1. **Backend — Add Scheduler API endpoints** in `~/PraisonAIUI/src/praisonaiui/server.py`:
   - `GET /api/schedules` — List all scheduled agents with status and stats
   - `POST /api/schedules` — Create a new schedule (agent, task, schedule_expr, max_retries, timeout, max_cost)
   - `PUT /api/schedules/{id}` — Update schedule configuration
   - `DELETE /api/schedules/{id}` — Remove a schedule
   - `POST /api/schedules/{id}/run` — Trigger immediate execution
   - `POST /api/schedules/{id}/stop` — Stop a running schedule
   - `GET /api/schedules/{id}/stats` — Get execution statistics
   - Integrate with `AgentScheduler` class from praisonai-package, importing it appropriately

2. **Backend — Schedule persistence**:
   - Store schedule definitions in a YAML/JSON file alongside the existing config
   - Load schedules on server startup and start them automatically
   - Track run history in-memory with periodic flush

3. **Frontend — Add Scheduler dashboard page**:
   - Schedule list: table/cards showing each schedule (name, expression, status, last run, next run, cost)
   - Create/Edit form: agent selector, task input, schedule expression picker (presets: hourly/daily/weekly + custom cron), retry/timeout/cost settings
   - Run history: expandable section per schedule showing past executions with results
   - Action buttons: Start, Stop, Run Now, Edit, Delete
   - Status indicators: Running (green pulse), Stopped (gray), Failed (red)

4. **Register the tab**: Add Scheduler tab to dashboard navigation.

### PHASE 3 — Verification (MUST)

1. Create a test schedule with a simple agent task and verify it appears in the UI
2. Test start/stop/run-now actions
3. Verify execution stats update after runs
4. Verify schedules persist across server restarts
5. Verify no regressions in existing functionality
6. Document what was implemented

---
---

## PROMPT 3: Jobs Management Tab (G3 — Phase 1, Critical)

You are an expert AI engineer. Your task: **Add a Jobs Management dashboard tab to PraisonAIUI** that surfaces the existing async Jobs API from the PraisonAI package.

### Context

PraisonAI package has a complete async jobs system:
- **Jobs directory**: `~/praisonai-package/src/praisonai/praisonai/jobs/` (6 files)
  - `executor.py` (14KB) — `JobExecutor` class:
    - `__init__(store, max_concurrent, default_timeout, cleanup_interval)`
    - `submit(job)` — submit job for execution
    - `cancel(job_id)` — cancel running job
    - `start()` / `stop()` — executor lifecycle
    - `register_progress_callback(job_id, callback)` — real-time progress
    - `_run_agent(job)` / `_run_recipe(job)` / `_run_praisonai_agents(job)` — multiple execution modes
    - `_send_webhook(job)` — webhook notifications on completion
    - `get_stats()` — executor statistics
  - `router.py` (11KB) — FastAPI router (`create_router(store, executor)`):
    - `POST /jobs` → `submit_job` (returns 202 + Location header + Retry-After)
    - `GET /jobs` → `list_jobs` (filter by status, session_id, pagination)
    - `GET /jobs/{id}/status` → `get_job_status`
    - `GET /jobs/{id}/result` → `get_job_result` (409 if not complete)
    - `DELETE /jobs/{id}/cancel` → `cancel_job` (409 if already complete)
    - `DELETE /jobs/{id}` → `delete_job` (only completed)
    - `GET /jobs/{id}/stream` → `stream_job` (SSE: status/progress/result/error events)
    - Supports idempotency via `Idempotency-Key` header
  - `models.py` (10KB) — `Job`, `JobStatus`, `JobSubmitRequest`, `JobSubmitResponse`, `JobStatusResponse`, `JobResultResponse`, `JobListResponse`
  - `store.py` (7KB) — `JobStore` — in-memory + persistent storage
  - `server.py` (5KB) — standalone server mounting the router

### PHASE 1 — Analysis (MUST complete before implementing)

1. **Read the full jobs system**: Go through every file in `~/praisonai-package/src/praisonai/praisonai/jobs/`:
   - `models.py` — understand all DTOs and status enum
   - `store.py` — understand storage backend (how jobs are persisted, queried)
   - `executor.py` — understand execution lifecycle (submit → execute → complete/fail)
   - `router.py` — understand all HTTP endpoints and their contracts
   - `server.py` — understand how the standalone server mounts the router

2. **Determine integration approach**: The jobs router is a FastAPI router. PraisonAIUI uses Starlette. Determine:
   - Can the jobs router be mounted directly in PraisonAIUI's Starlette app?
   - Or do we need to adapt the endpoints?
   - How to share the `JobStore` and `JobExecutor` instances with the main app

3. **Gap Analysis**: Document what's needed:
   - Backend: Mount or adapt the jobs router into PraisonAIUI
   - Frontend: Jobs dashboard showing job list, status, progress, results with real-time SSE updates

4. **Plan**: Step-by-step with exact files.

### PHASE 2 — Implementation (MUST)

1. **Backend — Mount Jobs API** in PraisonAIUI:
   - Initialize `JobStore` and `JobExecutor` in `create_app()`
   - Mount the jobs router at `/api/jobs/*` or adapt endpoints to Starlette
   - Ensure the executor starts when the app starts and stops when it stops

2. **Frontend — Add Jobs dashboard page**:
   - Jobs list: table with columns (ID, agent, status, progress %, submitted, duration, cost)
   - Status badges: Pending (gray), Running (blue pulse), Completed (green), Failed (red), Cancelled (yellow)
   - Real-time progress: Use SSE from `/jobs/{id}/stream` to update progress bars
   - Job detail view: expandable row showing full result, error message, webhook status
   - Actions: Submit new job (form), Cancel running job, Delete completed job
   - Filters: by status, date range, agent

3. **Register the tab**: Add Jobs tab to dashboard navigation.

### PHASE 3 — Verification (MUST)

1. Submit a test job via the UI and verify it appears in the list
2. Verify real-time progress updates via SSE
3. Test cancel and delete actions
4. Verify job results are displayed correctly after completion
5. Verify no regressions
6. Document what was implemented

---
---

## PROMPT 4: Usage Analytics Upgrade (G6 — Phase 1, Critical)

You are an expert AI engineer. Your task: **Upgrade PraisonAIUI's usage analytics** from basic token counters to per-model cost tracking with time-series charts.

### Context

Current state in PraisonAIUI (`~/PraisonAIUI/src/praisonaiui/server.py`):
- `_usage_stats` — simple in-memory dict tracking basic token counts
- `GET /api/usage` — returns this dict as JSON
- No cost calculation, no per-model breakdown, no time-series data, no charts

OpenClaw comparison: ~80KB of usage view code with per-model costs, per-session breakdown, time-series charts, export functionality.

### PHASE 1 — Analysis (MUST complete before implementing)

1. **Read PraisonAIUI usage tracking**: Read `server.py` and search for `_usage_stats`, understand:
   - Where/when usage is tracked (during `run_agent`, on SSE events)
   - What data is currently captured (input_tokens, output_tokens, total_tokens)
   - How the data flows from agent execution to the stats dict

2. **Research model pricing**: Understand common LLM pricing models:
   - OpenAI: per-1K tokens, different rates for input vs output, varies by model
   - Anthropic: per-1K tokens, input vs output
   - Google: per-1K tokens
   - Design a cost table data structure

3. **Design time-series storage**: Plan how to store usage data over time:
   - In-memory ring buffer with periodic flush to disk? SQLite? JSON file?
   - Granularity: per-request? per-minute? per-hour?
   - Retention: how much history to keep?

4. **Plan**: Step-by-step with exact files.

### PHASE 2 — Implementation (MUST)

1. **Backend — Enhanced usage tracking**:
   - Create a `UsageTracker` class (or enhance the existing tracking in `server.py`):
     - Track per-request: model, input_tokens, output_tokens, cost, timestamp, session_id, agent_name
     - Maintain aggregations: by model, by session, by agent, by time period
     - Cost calculation: configurable cost table (price per 1K input/output tokens per model)
   - Update `/api/usage` to return rich data:
     - `GET /api/usage` — summary (total cost, total tokens, by model, by period)
     - `GET /api/usage/details` — detailed time-series data for charts
     - `GET /api/usage/models` — per-model breakdown
     - `GET /api/usage/sessions` — per-session breakdown

2. **Backend — Cost table**:
   - Default cost table with common LLM model pricing
   - Configurable via YAML config (`cost_per_model` section)
   - Auto-detect model from provider responses

3. **Frontend — Usage analytics dashboard**:
   - Summary cards: Total cost ($), Total tokens, Requests count, Avg cost per request
   - Chart: Token/cost usage over time (line chart, selectable time range: 1h/24h/7d/30d)
   - Model breakdown: Bar chart or table showing cost per model
   - Session breakdown: Table showing per-session usage
   - Use a lightweight charting library (e.g., Chart.js via CDN, or SVG-based inline charts)

4. **Persistence**: Save usage data to a JSON/SQLite file so it survives server restarts.

### PHASE 3 — Verification (MUST)

1. Run an agent chat and verify usage data is captured with model and cost
2. Verify `/api/usage` returns enriched data
3. Verify charts render correctly in the dashboard
4. Verify data persists across server restarts
5. Verify no performance impact on chat response times
6. Document what was implemented

---
---

## PROMPT 5: Skills/Tools Management Tab (G4 — Phase 2, High)

You are an expert AI engineer. Your task: **Add a Skills/Tools Management dashboard tab to PraisonAIUI** that surfaces available tools and allows enable/disable/configuration.

### Context

PraisonAI package has tool infrastructure:
- **Capabilities**: `~/praisonai-package/src/praisonai/praisonai/capabilities/` (27 files)
  - `skills.py` (3KB) — skills endpoint
  - `completions.py`, `responses.py`, `assistants.py`, `files.py`, `images.py`, `audio.py`, `embeddings.py`, `fine_tuning.py`, `batches.py`, `guardrails.py`, `moderations.py`, `ocr.py`, `rag.py`, `realtime.py`, `rerank.py`, `search.py`, `videos.py`, `mcp.py`, `a2a.py`, `messages.py`, `vector_stores.py`, `container_files.py`, `containers.py`, `passthrough.py`
- **Tool resolver**: `~/praisonai-package/src/praisonai/praisonai/tool_resolver.py` (14KB) — dynamic tool resolution by name
- **Tools directory**: `~/praisonai-package/src/praisonai/praisonai/tools/` — audio.py, glob_tool.py, grep_tool.py, multiedit.py
- **Inbuilt tools**: `~/praisonai-package/src/praisonai/praisonai/inbuilt_tools/` — autogen_tools.py
- **Skills examples**: `~/praisonai-package/examples/skills/` — basic_skill_usage.py, create_skill_example.py, custom_skill_example.py

### PHASE 1 — Analysis (MUST complete before implementing)

1. **Read the tool/skills system**:
   - `capabilities/skills.py` — understand the skills endpoint interface
   - `tool_resolver.py` — understand how tools are discovered, resolved, loaded
   - `tools/` directory — understand the built-in tool pattern
   - `capabilities/__init__.py` — understand how capabilities are registered and discovered
   - Skills examples — understand the user-facing skill creation pattern

2. **Understand capability registration**: How does PraisonAI know which capabilities are available?
   - Are they auto-discovered? Explicitly registered? Config-driven?
   - Can individual capabilities be enabled/disabled?

3. **Gap Analysis**: Document what's needed:
   - API: Endpoint to list tools, get tool details, enable/disable, set API keys
   - Frontend: Skills tab with tool catalog, status toggles, API key configuration
   - Integration: How to wire capability enable/disable to the provider system

4. **Plan**: Step-by-step with exact files.

### PHASE 2 — Implementation (MUST)

1. **Backend — Skills API** in PraisonAIUI:
   - `GET /api/skills` — List all available tools/skills with status (name, type, enabled, description, required_keys)
   - `PUT /api/skills/{name}` — Enable/disable a skill
   - `PUT /api/skills/{name}/config` — Set API keys or configuration for a skill
   - `GET /api/skills/{name}` — Get detailed info about a specific skill

2. **Frontend — Skills dashboard page**:
   - Tool catalog: Grid/list of available tools with icons, names, descriptions
   - Status toggles: Enable/disable switch per tool
   - Configuration: Expandable config section per tool for API keys and settings
   - Categories: Group by type (built-in, capabilities, custom) 
   - Search/filter: Find tools by name or category

3. **Register the tab**: Add Skills tab to dashboard navigation.

### PHASE 3 — Verification (MUST)

1. Verify the skills list loads with correct tool inventory
2. Test enable/disable toggle and verify it affects agent tool availability
3. Test API key configuration
4. Verify no regressions
5. Document what was implemented

---
---

## PROMPT 6: Agent CRUD from Dashboard (G7 — Phase 2, High)

You are an expert AI engineer. Your task: **Add full Agent CRUD (Create, Update, Delete) to the PraisonAIUI dashboard**, extending beyond the current read-only agent listing.

### Context

Current state:
- PraisonAIUI `server.py`: `GET /agents` returns a list of registered agents (read-only)
- PraisonAI gateway: `WebSocketGateway.register_agent(agent, agent_id)` and `unregister_agent(agent_id)` exist
- Agents are currently registered programmatically via Python code, not from the UI

OpenClaw comparison: Full agent CRUD with file editing (system prompt, instructions), tool profile overrides (allow/deny lists), identity management (name, avatar).

### PHASE 1 — Analysis (MUST complete before implementing)

1. **Read the agent system end-to-end**:
   - `~/PraisonAIUI/src/praisonaiui/server.py` — how agents are registered, listed, used during `run_agent`
   - `~/praisonai-package/src/praisonai/praisonai/gateway/server.py` — `register_agent()`, `unregister_agent()`, `get_agent()`, `list_agents()`, `_create_agents_from_config()`
   - Understand the Agent class from praisonaiagents: what properties can be configured?

2. **Understand agent configuration format**:
   - How are agents defined in YAML? What fields?
   - System prompt, instructions, tool lists, model selection, temperature, etc.
   - How are agents loaded from config at startup?

3. **Design the CRUD model**: What data does agent create/update need?
   - Name, description, system prompt, instructions, model, temperature
   - Tool allow/deny lists
   - Avatar/icon

4. **Plan**: Step-by-step with exact files.

### PHASE 2 — Implementation (MUST)

1. **Backend — Agent CRUD endpoints** in PraisonAIUI:
   - `GET /agents` — (existing) List agents with full details
   - `POST /agents` — Create a new agent (name, description, system_prompt, instructions, model, tools, config)
   - `PUT /agents/{id}` — Update agent configuration
   - `DELETE /agents/{id}` — Remove an agent
   - `GET /agents/{id}` — Get detailed agent info including system prompt and tools
   - Persist agent definitions to a YAML/JSON file

2. **Frontend — Agent editor**:
   - Agent list with Create New button
   - Agent editor form: name, description, model selector, temperature slider
   - System prompt editor: multi-line text area with syntax highlighting
   - Instructions editor: multi-line text area
   - Tool configuration: checkbox list of available tools
   - Save/Cancel/Delete buttons
   - Inline validation

3. **Integration**: New/updated agents should be live-registerable without server restart.

### PHASE 3 — Verification (MUST)

1. Create a new agent from the dashboard and verify it appears in the list
2. Edit an agent's system prompt and verify the change takes effect in chat
3. Delete an agent and verify it's removed
4. Verify agents persist across server restarts
5. Document what was implemented

---
---

## PROMPT 7: Exec Approval Dashboard (G5 — Phase 2, High)

You are an expert AI engineer. Your task: **Add an Execution Approval dashboard to PraisonAIUI** that surfaces the existing approval system from the PraisonAI package bots.

### Context

PraisonAI package has a comprehensive approval system:
- **Approval infrastructure** in `~/praisonai-package/src/praisonai/praisonai/bots/`:
  - `_approval.py` — Core approval logic
  - `_approval_base.py` — Base class for approval backends
  - `_discord_approval.py` — Discord-specific approval flow
  - `_slack_approval.py` — Slack-specific approval flow
  - `_telegram_approval.py` — Telegram-specific approval flow
  - `_http_approval.py` — HTTP webhook-based approvals
  - `_webhook_approval.py` — Webhook notification for approvals

The approval system allows agents to request human approval before executing certain actions (tool calls, external API calls, destructive operations).

### PHASE 1 — Analysis (MUST complete before implementing)

1. **Read the full approval system**:
   - `_approval_base.py` — understand the base protocol/interface for approvals
   - `_approval.py` — understand the core approval lifecycle (request → pending → approve/deny)
   - `_http_approval.py` — understand the HTTP-based approval mechanism (this is most relevant for UI integration)
   - Each channel-specific approval file — understand how they present approval requests

2. **Understand the approval data model**:
   - What information is in an approval request? (agent, tool, arguments, risk level, timestamp)
   - What are the possible actions? (approve, deny, approve-always, deny-always)
   - How are policies stored? (auto-approve lists, always-deny lists)

3. **Determine integration approach**:
   - Can `_http_approval.py` be extended to serve as the UI backend?
   - Or do we need a separate approval queue accessible from PraisonAIUI?
   - Real-time: WebSocket for instant approval notifications?

4. **Plan**: Step-by-step with exact files.

### PHASE 2 — Implementation (MUST)

1. **Backend — Approval API** in PraisonAIUI:
   - `GET /api/approvals` — List pending approval requests
   - `POST /api/approvals/{id}/approve` — Approve a request
   - `POST /api/approvals/{id}/deny` — Deny a request
   - `GET /api/approvals/policies` — List approval policies (auto-approve, always-deny)
   - `PUT /api/approvals/policies` — Update policies
   - `GET /api/approvals/history` — Past approval decisions
   - WebSocket or SSE endpoint for real-time approval notifications

2. **Frontend — Approval dashboard page**:
   - Pending queue: Cards showing each pending request with agent name, action, arguments, risk level, timestamp
   - Approve/Deny buttons with optional "always" checkbox
   - Policy editor: Configure auto-approve/deny rules per tool, per agent
   - History: Table of past approvals with decision, timestamp, details
   - Real-time: New approvals appear instantly via WebSocket/SSE
   - Notification badge on the tab showing pending count

3. **Register the tab**: Add Approvals tab to dashboard navigation with badge.

### PHASE 3 — Verification (MUST)

1. Configure an agent with an approval-required tool
2. Trigger the tool and verify an approval request appears in the dashboard
3. Approve it and verify the agent continues execution
4. Deny a request and verify the agent handles it gracefully
5. Test auto-approve policy and verify it works
6. Document what was implemented

---
---

## PROMPT 8: OpenAI-Compatible API Routes (G — Phase 2, High)

You are an expert AI engineer. Your task: **Mount PraisonAI's 27 OpenAI-compatible capability endpoints in PraisonAIUI** so they are accessible via `/v1/*` routes.

### Context

PraisonAI package has 27 OpenAI-compatible capability endpoints:
- **Directory**: `~/praisonai-package/src/praisonai/praisonai/capabilities/` (27 files)
- Key endpoints: `completions.py`, `responses.py`, `assistants.py`, `files.py`, `images.py`, `audio.py`, `embeddings.py`, `fine_tuning.py`, `batches.py`, `guardrails.py`, `moderations.py`, `ocr.py`, `rag.py`, `realtime.py`, `rerank.py`, `search.py`, `skills.py`, `videos.py`, `mcp.py`, `a2a.py`, `messages.py`, `vector_stores.py`, `container_files.py`, `containers.py`, `passthrough.py`
- `__init__.py` (9KB) — likely contains registration/routing logic

PraisonAIUI uses Starlette. The capabilities likely use FastAPI routers.

### PHASE 1 — Analysis (MUST complete before implementing)

1. **Read `capabilities/__init__.py`**: Understand how capabilities are registered, what router/app they expose
2. **Read `completions.py`**: Understand the endpoint pattern (request/response format, OpenAI compatibility)
3. **Read `responses.py`**: Understand the responses API endpoint
4. **Understand the mount pattern**: How to integrate FastAPI routers into Starlette apps
5. **Plan**: Determine which capabilities to mount, routing prefix (`/v1/`), authentication, and configuration

### PHASE 2 — Implementation (MUST)

1. **Mount capabilities in PraisonAIUI**:
   - Import the capabilities router/app from praisonai-package
   - Mount at `/v1/` prefix in PraisonAIUI's Starlette app (in `create_app()`)
   - Ensure proper CORS, authentication, and error handling
   - Key routes: `/v1/chat/completions`, `/v1/responses`, `/v1/embeddings`, `/v1/images/generations`, etc.

2. **Configuration**: Add capability enable/disable flags in PraisonAIUI config YAML

3. **Documentation**: Add API docs endpoint or link to capability documentation

### PHASE 3 — Verification (MUST)

1. Test `/v1/chat/completions` with a standard OpenAI SDK client
2. Test `/v1/responses` endpoint
3. Verify compatibility with OpenAI Python SDK
4. Verify no regressions in existing PraisonAIUI functionality
5. Document the available endpoints

---
---

## PROMPT 9: Real-Time Log Streaming (G9 — Phase 3, Polish)

You are an expert AI engineer. Your task: **Upgrade PraisonAIUI's log viewer from polling to real-time WebSocket streaming**.

### Context

Current state in PraisonAIUI (`~/PraisonAIUI/src/praisonaiui/server.py`):
- `_log_buffer` — in-memory deque (500 entries max)
- `GET /api/logs` — returns the entire buffer as JSON (polling-based)
- Frontend polls this endpoint periodically

Goal: Real-time log tailing via WebSocket, with level filtering and search.

### PHASE 1 — Analysis (MUST complete before implementing)

1. **Read current logging implementation**: Search `server.py` for `_log_buffer`, understand how logs are captured and stored
2. **Understand Python logging integration**: How are Python logger messages routed to `_log_buffer`?
3. **Design WebSocket approach**: Plan the WebSocket endpoint, message format, filtering protocol
4. **Plan**: Step-by-step with exact files.

### PHASE 2 — Implementation (MUST)

1. **Backend — WebSocket log endpoint**:
   - `WS /api/logs/stream` — WebSocket endpoint that streams log entries in real-time
   - Support filter parameters: `level` (DEBUG/INFO/WARNING/ERROR), `search` (text match)
   - Keep the existing `GET /api/logs` for backward compatibility
   - Use Python logging handler that broadcasts to connected WebSocket clients

2. **Frontend — Enhanced log viewer**:
   - Real-time log display with auto-scroll
   - Level filter buttons (DEBUG, INFO, WARNING, ERROR) with color coding
   - Search box for text filtering
   - Pause/resume button to stop auto-scroll
   - Clear button
   - Timestamp formatting
   - Log level color coding (gray=DEBUG, blue=INFO, yellow=WARNING, red=ERROR)

### PHASE 3 — Verification (MUST)

1. Connect to the WebSocket and verify real-time log streaming
2. Test level filtering
3. Test search filtering
4. Verify auto-scroll and pause/resume
5. Verify backward compatibility of `GET /api/logs`
6. Document what was implemented

---
---

## PROMPT 10: Config Form Editor (G8 — Phase 3, Polish)

You are an expert AI engineer. Your task: **Upgrade PraisonAIUI's config editor from raw YAML to a schema-driven form editor**.

### Context

Current state:
- PraisonAIUI `server.py`: `GET /api/config` returns raw YAML, `POST /api/config` writes raw YAML
- PraisonAI package: `bots/_config_schema.py` — configuration schema definition
- No form rendering, no validation, no guided editing

OpenClaw comparison: Full schema-validated form rendering with live apply.

### PHASE 1 — Analysis (MUST complete before implementing)

1. **Read current config handling**: `server.py` → `api_config_handler`, `load_config_from_yaml`
2. **Read `_config_schema.py`**: Understand the config schema format (JSON Schema? Custom?)
3. **Understand the config structure**: What sections exist? (provider, model, channels, agents, scheduler, etc.)
4. **Design form rendering**: Plan how to render schema-driven forms in the frontend
5. **Plan**: Step-by-step with exact files.

### PHASE 2 — Implementation (MUST)

1. **Backend — Config schema endpoint**:
   - `GET /api/config/schema` — Return the config schema (JSON Schema format)
   - `POST /api/config/validate` — Validate config changes before applying
   - `POST /api/config/apply` — Apply config changes with validation and live reload

2. **Frontend — Form editor**:
   - Tab within the Config page: "Form View" vs "YAML View" toggle
   - Auto-generated form from JSON Schema:
     - Text inputs for strings, number inputs for numbers
     - Toggle switches for booleans
     - Dropdowns for enums (model selection, provider selection)
     - Nested sections with collapsible panels
   - Validation: Real-time validation with error messages
   - Save button with confirmation
   - Reset to defaults button
   - Keep raw YAML editor as alternative view

### PHASE 3 — Verification (MUST)

1. Verify the form renders all config sections correctly
2. Test editing a config value via form and verify it's saved
3. Test validation with invalid values
4. Verify toggle between form and YAML views
5. Verify config changes take effect without restart (where possible)
6. Document what was implemented

---
---

## PROMPT 11: Session Advanced Operations (G10 — Phase 3, Polish)

You are an expert AI engineer. Your task: **Add advanced session operations to PraisonAIUI**: reset context, compact memory, and session preview.

### Context

Current state in PraisonAIUI (`server.py`):
- `GET /sessions` — List sessions
- `GET /sessions/{id}` — Get session detail
- `GET /sessions/{id}/runs` — Get message history
- `DELETE /sessions/{id}` — Delete session
- `PATCH /sessions/{id}` — Rename/tag session
- `POST /sessions` — Create session

Missing (present in OpenClaw): Reset context (clear memory but keep session), Compact memory (summarize old messages to reduce context), Preview (rich preview of session content).

### PHASE 1 — Analysis (MUST complete before implementing)

1. **Read current session system** in `server.py`: Understand how sessions store messages, how context is managed
2. **Read session system in praisonai-package**: `bots/_session.py` — understand session state management
3. **Design**: Plan reset (clear messages, keep metadata), compact (LLM-summarize old messages), preview (formatted message display)
4. **Plan**: Step-by-step with exact files.

### PHASE 2 — Implementation (MUST)

1. **Backend — Advanced session endpoints**:
   - `POST /sessions/{id}/reset` — Clear all messages but keep session metadata
   - `POST /sessions/{id}/compact` — Summarize old messages using the LLM, replace them with a summary message
   - `GET /sessions/{id}/preview` — Return formatted preview (first/last messages, total count, token estimate)

2. **Frontend — Enhanced session management**:
   - Add action buttons to session list: Reset, Compact, Preview
   - Reset confirmation dialog
   - Compact: Show before/after message count and token savings
   - Preview: Modal showing session summary without loading full history

### PHASE 3 — Verification (MUST)

1. Test reset: verify messages are cleared, session metadata preserved
2. Test compact: verify old messages are replaced with a summary
3. Test preview: verify formatted preview is returned
4. Verify no regressions in existing session operations
5. Document what was implemented

---
---

## PROMPT 12: Auth Enhancements (G11 — Phase 3, Polish)

You are an expert AI engineer. Your task: **Enhance PraisonAIUI's authentication** from a single `require_auth` flag to multi-mode auth support.

### Context

Current state in PraisonAIUI (`server.py`):
- `require_auth: bool` parameter in `create_app()` — single flag
- No token management, no API key support, no user-level access control

OpenClaw comparison: Token + password + trusted-proxy + device auth modes.

PraisonAI package security: `~/praisonai-package/src/praisonai/praisonai/security/` — security module (read this first).

### PHASE 1 — Analysis (MUST complete before implementing)

1. **Read current auth**: `server.py` → understand how `require_auth` is implemented
2. **Read praisonai-package security**: `~/praisonai-package/src/praisonai/praisonai/security/` — understand what security infrastructure exists
3. **Design multi-mode auth**:
   - API key auth (for programmatic access)
   - Token/session auth (for dashboard users)
   - Optional password auth (for initial setup)
4. **Plan**: Step-by-step with exact files.

### PHASE 2 — Implementation (MUST)

1. **Backend — Auth middleware**:
   - API key authentication: `X-API-Key` header or `?api_key=` query param
   - Session token authentication: JWT or session cookie for dashboard
   - Configurable auth mode in YAML config
   - Auth middleware in Starlette that checks configured mode

2. **Frontend — Auth UI**:
   - Login page (if password auth enabled)
   - API key display/rotation in settings
   - Session management (logout, token refresh)

3. **Configuration**: Auth section in YAML config with mode selection and credentials

### PHASE 3 — Verification (MUST)

1. Test API key auth with curl
2. Test session auth via dashboard login
3. Verify unauthenticated requests are rejected
4. Verify auth can be disabled for development
5. Document auth configuration options
