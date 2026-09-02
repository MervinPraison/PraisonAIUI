# Features REST API Reference

Complete API reference for all **36** PraisonAIUI feature protocol endpoints.

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
  "count": 36
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

### POST /api/memory/context
Get memory context for prompt injection.

```json
// Request
{"query": "user preferences", "limit": 5}

// Response
{"context": "Relevant memories:\n- The user prefers dark mode\n- User likes Python"}
```

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

---

## TTS (Text-to-Speech)

### GET /api/tts/voices
List available voices.

```json
// Response
{"voices": [
    {"id": "default", "name": "Default", "lang": "en-US"},
    {"id": "google-us", "name": "Google US English", "lang": "en-US"},
    {"id": "google-uk", "name": "Google UK English", "lang": "en-GB"}
], "count": 3}
```

### POST /api/tts/synthesize
Synthesize speech from text.

```json
// Request
{"text": "Hello from PraisonAI", "voice": "default"}

// Response (browser)
{"type": "browser_speech", "text": "Hello from PraisonAI", "voice": "default",
 "instruction": "Use window.speechSynthesis.speak(new SpeechSynthesisUtterance(text))"}
```

---

## Marketplace

Plugin discovery, search, install, and management.

### GET /api/marketplace/plugins
List all available plugins.

```json
// Response
{"plugins": [
    {"id": "web_search", "name": "Web Search", "category": "tools", "version": "1.0.0", "installed": false},
    {"id": "code_executor", "name": "Code Executor", "category": "tools", "version": "1.0.0", "installed": false},
    {"id": "file_manager", "name": "File Manager", "category": "tools", "version": "1.0.0", "installed": false},
    {"id": "memory_plugin", "name": "Memory Plugin", "category": "memory", "version": "1.0.0", "installed": false}
], "count": 4}
```

### POST /api/marketplace/search
Search plugins by query.

```json
// Request
{"query": "search", "limit": 20}

// Response
{"results": [{"id": "web_search", "name": "Web Search", ...}], "count": 1}
```

### POST /api/marketplace/install
Install a plugin.

```json
// Request
{"plugin_id": "web_search"}

// Response
{"status": "installed", "plugin": "web_search"}
```

### POST /api/marketplace/uninstall
Uninstall a plugin.

```json
// Request
{"plugin_id": "web_search"}

// Response
{"status": "uninstalled", "plugin": "web_search"}
```

### GET /api/marketplace/plugins/{id}
Get plugin details.

```json
// Response
{"id": "web_search", "name": "Web Search", "category": "tools",
 "version": "1.0.0", "description": "Search the web using DuckDuckGo", "installed": true}
```

---

## Code Execution

Sandboxed code execution with language allowlists.

### GET /api/code/languages
List supported languages.

```json
// Response
{"languages": [
    {"id": "python", "name": "Python", "version": "3.x"},
    {"id": "javascript", "name": "JavaScript", "version": "ES2020"},
    {"id": "bash", "name": "Bash", "version": "5.x"}
], "count": 3}
```

### POST /api/code/execute
Execute code in sandbox.

```json
// Request
{"code": "print('hello')", "language": "python", "timeout": 30}

// Response (simulated)
{"language": "python", "status": "simulated",
 "output": "[Sandbox] Code received (15 chars, python)",
 "sandbox": true, "note": "Install praisonaiagents for real execution"}

// Response (disallowed language → 400)
{"status": "error", "error": "Language 'ruby' not allowed",
 "allowed": ["python", "bash", "javascript"]}
```

---

## PWA

Progressive Web App support — manifest, service worker, and installability.

### GET /manifest.json
Web Application Manifest for installability.

```json
// Response
{"name": "PraisonAI", "short_name": "AI", "start_url": "/",
 "display": "standalone", "theme_color": "#1a1a2e", "background_color": "#16213e",
 "icons": [{"src": "/api/pwa/icon/192", "sizes": "192x192", "type": "image/png"}, ...],
 "orientation": "portrait-primary", "scope": "/"}
```

### GET /sw.js
Service Worker JavaScript with cache-first strategy.

### GET /api/pwa/config
PWA configuration details.

```json
// Response
{"manifest": {...}, "has_sw": true}
```

---

## i18n

Internationalization with locale switching and string lookup.

### GET /api/i18n/locales
List available locales.

```json
// Response
{"locales": [
    {"code": "en", "name": "English", "native": "English"},
    {"code": "es", "name": "Spanish", "native": "Español"},
    {"code": "fr", "name": "French", "native": "Français"}
], "count": 3}
```

### GET /api/i18n/strings/{locale}
Get all strings for a locale.

```json
// Response
{"locale": "es", "strings": {
    "app.title": "PraisonAI", "app.welcome": "Bienvenido a PraisonAI",
    "chat.send": "Enviar", "nav.dashboard": "Panel", ...
}, "count": 11}
```

### POST /api/i18n/translate
Translate a key with optional variables.

```json
// Request
{"key": "app.welcome", "locale": "fr"}

// Response
{"key": "app.welcome", "text": "Bienvenue sur PraisonAI"}
```

### GET /api/i18n/locale
Get current default locale.

```json
// Response
{"locale": "en"}
```

### POST /api/i18n/locale
Set default locale.

```json
// Request
{"locale": "fr"}

// Response
{"locale": "fr"}
```

---

## Device Pairing

Pair devices to sessions using short hex codes.

### POST /api/pairing/create
Generate a pairing code.

```json
// Request
{"session_id": "my-session"}

// Response (201)
{"code": "723BE2", "session_id": "my-session",
 "created_at": 1772834103.42, "expires_at": 1772834403.42, "used": false}
```

### POST /api/pairing/validate
Validate and consume a pairing code.

```json
// Request
{"code": "723BE2"}

// Response (valid)
{"valid": true, "device_id": "f408fdebd954d8da", "session_id": "my-session"}

// Response (reused → 400)
{"valid": false, "error": "Code already used"}

// Response (expired → 400)
{"valid": false, "error": "Code expired"}
```

### GET /api/pairing/devices
List paired devices. Query: `?session_id=my-session`

```json
// Response
{"devices": [{"device_id": "f408fdebd954d8da", "session_id": "my-session",
  "paired_at": 1772834103.56, "user_agent": "unknown"}], "count": 1}
```

### DELETE /api/pairing/devices/{id}
Remove a paired device.

```json
// Response
{"deleted": "f408fdebd954d8da"}

// Response (not found → 404)
{"error": "Device not found"}
```

---

## Media Analysis

Image understanding, OCR, and object detection via VisionAgent.

### GET /api/media/capabilities
List analysis capabilities.

```json
// Response
{"capabilities": ["image_description", "ocr", "object_detection", "image_qa"], "count": 4}
```

### POST /api/media/analyze
Analyze an image.

```json
// Request
{"url": "https://example.com/photo.jpg", "prompt": "What is in this image?"}
// or
{"base64_data": "iVBORw0KGgo...", "mime_type": "image/png"}

// Response (SDK available)
{"analysis": "The image shows a sunset...", "status": "success", "provider": "sdk"}

// Response (simulated)
{"analysis": "[Simulated] Image analysis for: ...",
 "status": "simulated", "provider": "fallback",
 "note": "Install praisonaiagents for real analysis"}

// Response (no image → 400)
{"error": "No image provided", "status": "error"}
```

### POST /api/media/ocr
Extract text from an image.

```json
// Request
{"url": "https://example.com/document.png"}

// Response
{"text": "Extracted text from the document...", "status": "success", "provider": "sdk"}
```

---

## Guardrails

Input/output safety guardrails — validation rules, violation tracking, and registration.

### GET /api/guardrails
List all registered guardrails.

```json
// Response
{"guardrails": [], "total": 0, "gateway_connected": true}
```

### GET /api/guardrails/status
Guardrails feature health.

```json
// Response
{"status": "ok", "feature": "guardrails", "gateway_connected": true, "gateway_agent_count": 2}
```

### GET /api/guardrails/violations
List guardrail violations.

```json
// Response
{"violations": [], "total": 0, "time_window": "24h"}
```

### POST /api/guardrails/register
Register a guardrail rule.

```json
// Request
{"name": "no-pii", "type": "output", "pattern": "\\b\\d{3}-\\d{2}-\\d{4}\\b", "action": "block"}

// Response (201)
{"id": "gr_abc", "name": "no-pii", "type": "output", "status": "active"}
```

---

## Eval

Agent evaluation — accuracy scoring, judge models, and evaluation runs.

### GET /api/eval
Overview of evaluation state.

```json
// Response
{"evaluations": [], "total": 0, "gateway_connected": true}
```

### GET /api/eval/status
Eval feature health.

```json
// Response
{"status": "ok", "feature": "eval", "gateway_connected": true, "gateway_agent_count": 2}
```

### GET /api/eval/scores
Get evaluation scores.

```json
// Response
{"scores": [], "total": 0, "avg_score": null}
```

### GET /api/eval/judges
List configured judge models.

```json
// Response
{"judges": ["gpt-4o", "claude-3-5-sonnet"], "total": 2}
```

### POST /api/eval/run
Run an evaluation.

```json
// Request
{"agent_name": "assistant", "test_cases": [{"input": "What is 2+2?", "expected": "4"}]}

// Response
{"run_id": "eval_abc", "status": "completed", "scores": [{"accuracy": 1.0}]}
```

---

## Telemetry

Performance monitoring — metrics collection, performance stats, and profiling.

### GET /api/telemetry
Telemetry overview.

```json
// Response
{"metrics": [], "total": 0, "collection_active": true, "gateway_connected": true}
```

### GET /api/telemetry/status
Telemetry feature health.

```json
// Response
{"status": "ok", "feature": "telemetry", "gateway_connected": true, "gateway_agent_count": 2}
```

### GET /api/telemetry/metrics
Get collected metrics.

```json
// Response
{"metrics": [], "total": 0, "types": ["counter", "gauge", "histogram"]}
```

### GET /api/telemetry/performance
Get performance statistics.

```json
// Response
{"performance": {"avg_response_time_ms": null, "p95_response_time_ms": null, "total_requests": 0}}
```

### GET /api/telemetry/profiling
Get profiling data.

```json
// Response
{"profiles": [], "total": 0, "profiling_enabled": false}
```

### POST /api/telemetry/record
Record a telemetry event.

```json
// Request
{"metric": "response_time", "value": 150, "tags": {"agent": "assistant"}}

// Response (201)
{"id": "tel_abc", "metric": "response_time", "recorded_at": 1709000000.0}
```

---

## Traces

Distributed tracing and observability — span recording, trace lookup, and span details.

### GET /api/traces
List recent traces.

```json
// Response
{"traces": [], "total": 0, "gateway_connected": true}
```

### GET /api/traces/status
Tracing feature health.

```json
// Response
{"status": "ok", "feature": "tracing", "gateway_connected": true, "gateway_agent_count": 2}
```

### GET /api/traces/spans
List trace spans.

```json
// Response
{"spans": [], "total": 0, "filters": ["agent_name", "status", "duration"]}
```

### POST /api/traces/record
Record a trace span.

```json
// Request
{"trace_id": "tr_abc", "span_name": "agent.chat", "duration_ms": 250, "status": "ok"}

// Response (201)
{"id": "span_abc", "trace_id": "tr_abc", "recorded_at": 1709000000.0}
```

### GET /api/traces/{trace_id}
Get full trace details.

```json
// Response
{"trace_id": "tr_abc", "spans": [{"id": "span_abc", "name": "agent.chat", "duration_ms": 250}], "total_duration_ms": 250}
```

---

## Security

Security monitoring — audit logging, configuration review, and access control.

### GET /api/security
Security overview.

```json
// Response
{"audit_events": [], "total": 0, "security_level": "standard", "gateway_connected": true}
```

### GET /api/security/status
Security feature health.

```json
// Response
{"status": "ok", "feature": "security", "gateway_connected": true, "gateway_agent_count": 2}
```

### GET /api/security/audit
Get audit log entries.

```json
// Response
{"events": [], "total": 0, "filters": ["severity", "actor", "action", "timestamp"]}
```

### GET /api/security/config
Get security configuration.

```json
// Response
{"config": {"auth_mode": "none", "rate_limiting": false, "cors_origins": ["*"]}, "recommendations": []}
