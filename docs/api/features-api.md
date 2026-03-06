# Features REST API Reference

Complete API reference for all PraisonAIUI feature protocol endpoints.

## Feature Registry

### GET /api/features

List all registered features with health status.

**Response:**
```json
{
  "features": [
    {
      "name": "approvals",
      "description": "Tool-execution approval management",
      "health": {"status": "ok", "feature": "approvals"},
      "routes": ["/api/approvals", "/api/approvals/{id}", ...]
    }
  ],
  "count": 16
}
```

---

## Approvals

Tool-execution approval management with policies, history, and SSE streaming.

### GET /api/approvals
List all approvals.

### POST /api/approvals
Create an approval request.

```json
// Request
{"tool_name": "execute_command", "arguments": {"command": "rm -rf /tmp/test"}, "risk_level": "high", "agent_name": "SystemAgent"}

// Response (201)
{"id": "abc123", "tool_name": "execute_command", "status": "pending", "risk_level": "high", "risk_icon": "🟠", "created_at": 1709000000.0}
```

### GET /api/approvals/pending
List pending approvals only.

### GET /api/approvals/history
List resolved approvals.

### GET /api/approvals/policies
Get auto-approve/deny policies.

```json
// Response
{"auto_approve_tools": ["read_file"], "always_deny_tools": [], "auto_approve_agents": [], "risk_threshold": "high"}
```

### PUT /api/approvals/policies
Update policies.

### GET /api/approvals/stream
SSE stream for real-time approval notifications.

### GET /api/approvals/{id}
Get single approval by ID.

### POST /api/approvals/{id}/approve
Approve a pending request. Body: `{"reason": "...", "always": false}`

```json
// Response
{"id": "abc123", "status": "approved", "resolved_at": 1709000001.0, "resolved_by": "admin"}
```

### POST /api/approvals/{id}/deny
Deny a pending request. Body: `{"reason": "...", "always": false}`

---

## Channels

### GET /api/channels
List all configured channels with live gateway status.

```json
// Response
{
  "channels": [
    {"id": "tg1", "name": "Support Bot", "platform": "telegram", "enabled": true, "running": true, "last_activity": 1709000000.0}
  ],
  "count": 1
}
```

### POST /api/channels
Add a channel.

```json
// Request
{"name": "Discord Bot", "platform": "discord", "enabled": true, "config": {"token": "..."}}

// Response (201)
{"id": "abc123", "name": "Discord Bot", "platform": "discord", "enabled": true, "running": false, "created_at": 1709000000.0}
```

### GET /api/channels/platforms
List supported platforms.

```json
// Response
{"platforms": ["discord", "slack", "telegram", "whatsapp", "imessage", "signal", "googlechat", "nostr"]}
```

### GET /api/channels/{id}
Get channel details.

### PUT /api/channels/{id}
Update channel configuration. Body fields: `name`, `platform`, `enabled`, `config`.

### DELETE /api/channels/{id}
Remove a channel.

### POST /api/channels/{id}/toggle
Toggle channel enabled/disabled.

### GET /api/channels/{id}/status
Get live channel status (enriched via gateway).

```json
// Response
{"id": "tg1", "name": "Support Bot", "platform": "telegram", "enabled": true, "running": true, "last_activity": 1709000000.0}
```

### POST /api/channels/{id}/restart
Restart a channel bot via the gateway. Returns status of restart attempt.

```json
// Response (gateway connected)
{"id": "tg1", "status": "restarted", "running": true, "message": "Channel 'tg1' restarted successfully"}

// Response (no gateway)
{"id": "tg1", "status": "pending", "running": false, "message": "Channel marked for restart (no gateway connected)"}
```

---

## Schedules

### POST /api/schedules
Add a scheduled job.

```json
// Request
{"name": "hourly-check", "message": "Run health check", "schedule": {"kind": "every", "every_seconds": 3600}}

// Response (201)
{"id": "job123", "name": "hourly-check", "schedule": {"kind": "every", "every_seconds": 3600}, "enabled": true}
```

### GET /api/schedules
List all scheduled jobs.

### GET /api/schedules/{id}
Get job details.

### PUT /api/schedules/{id}
Update schedule configuration. Body fields: `name`, `message`, `schedule`, `enabled`.

### DELETE /api/schedules/{id}
Remove a job.

### POST /api/schedules/{id}/toggle
Toggle job enabled/disabled.

### POST /api/schedules/{id}/run
Trigger job immediately.

### POST /api/schedules/{id}/stop
Stop a running scheduled job. Attempts to cancel via `AgentScheduler` if available.

```json
// Response
{"id": "job123", "status": "stopped", "message": "Schedule 'hourly-check' stopped"}
```

### GET /api/schedules/{id}/stats
Get execution statistics for a schedule.

```json
// Response
{"id": "job123", "name": "hourly-check", "total_runs": 24, "successful_runs": 23, "failed_runs": 1, "total_cost": 0.045, "last_run": 1709000000.0, "next_run": 1709003600.0}
```

---

## Jobs

### POST /api/jobs
Submit a new async job. Returns 202 Accepted.

```json
// Request
{"prompt": "Analyze sales data", "agent": "analyst", "config": {"model": "gpt-4o", "timeout": 300}}

// Response (202)
{"id": "job_abc123", "status": "queued", "prompt": "Analyze sales data", "created_at": 1709000000.0}
```

### GET /api/jobs
List jobs with optional filters. Query: `?status=running`, `?limit=50`, `?offset=0`

```json
// Response
{"jobs": [...], "total": 5, "offset": 0, "limit": 50}
```

### GET /api/jobs/stats
Get executor statistics.

```json
// Response
{"total_jobs": 100, "queued": 2, "running": 1, "succeeded": 90, "failed": 5, "cancelled": 2}
```

### GET /api/jobs/{id}
Get full job details.

### GET /api/jobs/{id}/status
Get job status with progress info.

```json
// Response
{"id": "job_abc123", "status": "running", "progress": 45, "started_at": 1709000001.0, "elapsed": 30.5}
```

### GET /api/jobs/{id}/result
Get job result. Returns 409 if not yet complete.

```json
// Response (completed)
{"id": "job_abc123", "status": "succeeded", "result": "Analysis complete: revenue up 15%..."}

// Response (not complete, 409)
{"error": "Job not yet complete", "status": "running"}
```

### POST /api/jobs/{id}/cancel
Cancel a running or queued job. Returns 409 if already complete.

### DELETE /api/jobs/{id}
Delete a completed job. Returns 409 if still running.

### GET /api/jobs/{id}/stream
SSE stream for real-time job updates. Events: `status`, `progress`, `result`, `error`, `done`.

```
event: status
data: {"status": "running"}

event: progress
data: {"progress": 45}

event: result
data: {"result": "Analysis complete..."}

event: done
data: {"status": "succeeded"}
```

---

## Usage

### GET /api/usage
Usage summary with totals and averages.

```json
// Response
{"total_requests": 50, "total_input_tokens": 25000, "total_output_tokens": 12000, "total_cost_usd": 0.45, "avg_cost_per_request": 0.009}
```

### POST /api/usage/track
Track a usage event.

```json
// Request
{"model": "gpt-4o", "input_tokens": 500, "output_tokens": 200, "session_id": "s1", "agent_name": "analyst"}

// Response (201)
{"id": "u_abc123", "model": "gpt-4o", "cost_usd": 0.00325, "timestamp": 1709000000.0}
```

### GET /api/usage/details
Detailed usage records. Query: `?limit=100`, `?offset=0`

### GET /api/usage/models
Per-model breakdown (tokens, cost, request count).

### GET /api/usage/sessions
Per-session breakdown.

### GET /api/usage/agents
Per-agent breakdown.

### GET /api/usage/timeseries
Time-series data for charts. Query: `?hours=24`, `?bucket_minutes=60`

```json
// Response
{"buckets": [{"timestamp": 1709000000.0, "requests": 5, "tokens": 3000, "cost": 0.02}, ...]}
```

### GET /api/usage/costs
Get the model cost table (per-1K token rates for 21 models).

---

## Memory

### POST /api/memory
Add a memory entry.

```json
// Request
{"text": "User prefers dark mode", "memory_type": "long"}

// Response (201)
{"id": "mem123", "text": "User prefers dark mode", "memory_type": "long", "created_at": 1709000000.0}
```

### POST /api/memory/search
Search memories.

```json
// Request
{"query": "dark mode", "limit": 10, "memory_type": "all"}

// Response
{"results": [...], "count": 1}
```

### GET /api/memory
List all memories. Query: `?type=short|long|entity|all`

### GET /api/memory/{id}
Get single memory.

### DELETE /api/memory/{id}
Delete single memory.

### DELETE /api/memory
Clear memories. Query: `?type=all`

---

## Extended Sessions

### GET /api/sessions/{session_id}/state
Get session state.

### POST /api/sessions/{session_id}/state
Save session state.

```json
// Request
{"state": {"mood": "happy", "level": 5}}
```

### POST /api/sessions/{session_id}/context
Build context from session state + memory.

```json
// Request
{"query": "What's the user mood?"}
```

### POST /api/sessions/{session_id}/compact
Compact session data. Returns before/after stats.

### POST /api/sessions/{session_id}/reset
Reset session. Body: `{"mode": "clear"}`

### GET /api/sessions/{session_id}/preview
Formatted session preview without full history.

### GET/POST /api/sessions/{session_id}/labels
Get or set session labels.

### GET /api/sessions/{session_id}/usage
Get session usage statistics.

---

## Skills

Tool catalog with 18 built-in tools across 7 categories (search, crawl, file, code, shell, skills, schedule).

### GET /api/skills
List all tools. Query: `?category=search`, `?enabled=true`, `?search=web`

```json
// Response
{"skills": [{"id": "internet_search", "name": "internet_search", "category": "search", "enabled": true, "builtin": true, "required_keys": []}], "total": 18}
```

### GET /api/skills/categories
List tool categories.

```json
// Response
{"categories": ["search", "crawl", "file", "code", "shell", "skills", "schedule"]}
```

### POST /api/skills
Register a custom skill.

```json
// Request
{"name": "my_tool", "description": "Does something", "category": "custom"}

// Response (201)
{"id": "my_tool", "name": "my_tool", "category": "custom", "enabled": true, "builtin": false}
```

### GET /api/skills/{id}
Get tool details including required API keys.

### PUT /api/skills/{id}
Update a custom skill.

### DELETE /api/skills/{id}
Remove a custom skill (builtin tools cannot be deleted).

### POST /api/skills/{id}/toggle
Toggle tool enabled/disabled.

### PUT /api/skills/{id}/config
Set tool configuration or API keys.

```json
// Request
{"TAVILY_API_KEY": "tvly-xxx"}
```

---

## Hooks

### POST /api/hooks
Register a hook.

```json
// Request
{"name": "on_tool_call", "event": "tool_call", "type": "pre"}

// Response (201)
{"id": "hook123", "name": "on_tool_call", "event": "tool_call", "type": "pre"}
```

### GET /api/hooks
List all hooks.

### GET /api/hooks/log
View hook execution log. Query: `?limit=20`

### GET /api/hooks/{id}
Get hook details.

### POST /api/hooks/{id}/trigger
Trigger a hook manually.

```json
// Request
{"data": {"tool": "test"}}

// Response
{"hook_id": "hook123", "result": "triggered"}
```

### DELETE /api/hooks/{id}
Remove hook.

---

## Workflows

### POST /api/workflows
Create a workflow.

```json
// Request
{"name": "deploy-pipeline", "description": "Build, test, deploy", "pattern": "pipeline", "steps": ["build", "test", "deploy"]}

// Response (201)
{"id": "wf123", "name": "deploy-pipeline", "pattern": "pipeline", "steps": ["build", "test", "deploy"]}
```

### GET /api/workflows
List all workflows.

### GET /api/workflows/runs
List all workflow runs.

### GET /api/workflows/runs/{run_id}
Get run details.

### GET /api/workflows/{id}
Get workflow details.

### POST /api/workflows/{id}/run
Execute a workflow.

```json
// Request
{"input": {"env": "staging"}}

// Response
{"id": "run123", "status": "completed", "output": {"message": "Workflow 'deploy-pipeline' executed successfully"}}
```

### GET /api/workflows/{id}/status
Get workflow status (total runs, last run).

### DELETE /api/workflows/{id}
Delete workflow.

---

## Config Runtime

### GET /api/config/runtime
Get all runtime config.

### PATCH /api/config/runtime
Merge config values.

```json
// Request
{"model": "gpt-4o", "temperature": "0.7"}

// Response
{"config": {"model": "gpt-4o", "temperature": "0.7"}, "applied": 2}
```

### PUT /api/config/runtime
Replace entire config.

### GET /api/config/runtime/history
Config change history. Query: `?limit=50`

### GET /api/config/runtime/{key}
Get single config key.

### PUT /api/config/runtime/{key}
Set single config key.

```json
// Request
{"value": "0.9"}
```

### DELETE /api/config/runtime/{key}
Delete config key.

### GET /api/config/schema
JSON Schema for schema-driven form rendering.

```json
// Response
{"sections": {"provider": {"type": "object", "properties": {"name": {"type": "string", "enum": ["openai", "anthropic", "google"]}}}, ...}}
```

### POST /api/config/validate
Validate config without applying.

```json
// Request
{"provider": "openai", "model": "gpt-4o"}

// Response
{"valid": true, "errors": []}
```

### POST /api/config/apply
Validate and apply config changes.

### GET /api/config/defaults
Get default values from schema.

---

## Agents

Agent definition CRUD with model selection, system prompts, and duplication.

### GET /api/agents/definitions
List all agent definitions.

```json
// Response
{"agents": [{"id": "agent_abc", "name": "Research Assistant", "model": "gpt-4o", "icon": "🔬", "status": "active"}], "count": 1}
```

### POST /api/agents/definitions
Create a new agent.

```json
// Request
{"name": "Research Assistant", "description": "Helps with research", "model": "gpt-4o", "temperature": 0.7, "system_prompt": "You are...", "instructions": "...", "tools": [], "icon": "🔬"}

// Response (201)
{"id": "agent_abc", "name": "Research Assistant", "model": "gpt-4o", "status": "active", "created_at": 1709000000.0}
```

### GET /api/agents/definitions/{id}
Get agent details.

### PUT /api/agents/definitions/{id}
Update agent. Body fields: `name`, `description`, `model`, `temperature`, `system_prompt`, `instructions`, `tools`, `icon`.

### DELETE /api/agents/definitions/{id}
Delete agent.

### GET /api/agents/models
List available models (13 models across OpenAI, Anthropic, Google).

```json
// Response
{"models": [{"id": "gpt-4o", "name": "GPT-4o", "provider": "openai"}, ...], "count": 13}
```

### POST /api/agents/run/{id}
Execute an agent via `praisonaiagents.Agent.start()`.

```json
// Request
{"prompt": "Research the latest AI trends"}

// Response
{"result": "...", "model": "gpt-4o", "agent_id": "agent_abc"}
```

### POST /api/agents/duplicate/{id}
Duplicate an existing agent.

```json
// Response (201)
{"id": "agent_xyz", "name": "Research Assistant (copy)", "model": "gpt-4o", "status": "active"}
```

---

## OpenAI-Compatible API

Drop-in replacement for OpenAI SDK. Use `base_url="http://localhost:8000/v1"`.

### GET /v1
API info with available endpoint list.

### POST /v1/chat/completions
Chat completions (OpenAI-compatible).

```json
// Request
{"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "Hello!"}]}

// Response
{"id": "chatcmpl-xxx", "object": "chat.completion", "model": "gpt-4o-mini", "choices": [{"message": {"role": "assistant", "content": "..."}}]}
```

### POST /v1/completions
Legacy text completions.

### POST /v1/embeddings
Create embeddings.

```json
// Request
{"model": "text-embedding-3-small", "input": "Hello world"}
```

### POST /v1/images/generations
Generate images (DALL-E).

### POST /v1/audio/transcriptions
Transcribe audio (Whisper).

### POST /v1/audio/speech
Text to speech.

### POST /v1/moderations
Content moderation.

### GET /v1/models
List available models (13 models).

### GET /v1/models/{id}
Get model info.

### POST /v1/responses
OpenAI Responses API.

### GET/POST /v1/files
File management.

### GET/DELETE /v1/files/{id}
File operations.

### GET/POST /v1/assistants
Assistants API.

---

## Logs

Real-time log streaming via WebSocket.

### WS /api/logs/stream
WebSocket for real-time log streaming. Query: `?level=INFO`, `?search=agent`

```json
// Messages received
{"type": "initial", "data": [...], "total": 100}
{"type": "log", "data": {"timestamp": "...", "level": "INFO", "logger": "...", "message": "..."}}

// Send filter update
{"type": "filter", "level": "ERROR", "search": "error"}
```

### GET /api/logs/levels
Available log levels with colors.

```json
// Response
{"levels": [{"name": "DEBUG", "color": "#6b7280", "priority": 10}, {"name": "INFO", "color": "#3b82f6", "priority": 20}, ...]}
```

### GET /api/logs/stats
Log buffer statistics.

### POST /api/logs/clear
Clear the log buffer.

---

## Auth

Multi-mode authentication (none, api_key, session, password).

### GET /api/auth/status
Check current auth status.

```json
// Response
{"authenticated": true, "mode": "api_key", "user": "admin"}
```

### GET /api/auth/config
Get auth configuration.

```json
// Response
{"mode": "api_key", "session_timeout_hours": 24, "max_api_keys": 10}
```

### PUT /api/auth/config
Set auth configuration. Body: `{"mode": "session", "session_timeout_hours": 48}`

### GET /api/auth/keys
List API keys.

### POST /api/auth/keys
Create API key.

```json
// Request
{"name": "CI/CD Key", "expires_days": 90}

// Response (201)
{"id": "key_abc", "name": "CI/CD Key", "key": "sk-xxx", "created_at": 1709000000.0}
```

### DELETE /api/auth/keys/{id}
Revoke API key.

### POST /api/auth/login
Login with password.

```json
// Request
{"password": "..."}

// Response
{"token": "sess_xxx", "expires_at": 1709086400.0}
```

### POST /api/auth/logout
Logout current session.

### GET /api/auth/sessions
List active sessions.

### POST /api/auth/password
Set or change password.
