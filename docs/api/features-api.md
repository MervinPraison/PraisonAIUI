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
  "count": 8
}
```

---

## Approvals

### POST /api/approvals
Create an approval request.

```json
// Request
{"tool_name": "execute_code", "arguments": {"code": "..."}, "risk_level": "high", "agent_name": "TestAgent"}

// Response (201)
{"id": "abc123", "tool_name": "execute_code", "status": "pending", "created_at": 1709000000.0}
```

### GET /api/approvals
List approvals. Query: `?status=pending|resolved|all`

### GET /api/approvals/{id}
Get single approval by ID.

### POST /api/approvals/{id}/resolve
Resolve a pending approval.

```json
// Request
{"approved": true, "reason": "Looks safe"}

// Response
{"id": "abc123", "status": "approved", "resolved_at": 1709000001.0}
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

### DELETE /api/schedules/{id}
Remove a job.

### POST /api/schedules/{id}/toggle
Toggle job enabled/disabled.

### POST /api/schedules/{id}/run
Trigger job immediately.

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
Compact session data.

### POST /api/sessions/{session_id}/reset
Reset session. Body: `{"mode": "clear"}`

### GET/POST /api/sessions/{session_id}/labels
Get or set session labels.

### GET /api/sessions/{session_id}/usage
Get session usage statistics.

---

## Skills

### POST /api/skills
Register a skill.

```json
// Request
{"name": "web_search", "description": "Search the web", "version": "2.0.0"}

// Response (201)
{"id": "skill123", "name": "web_search", "status": "active", "version": "2.0.0"}
```

### GET /api/skills
List all skills.

### POST /api/skills/discover
Discover available skills.

### GET /api/skills/{id}
Get skill details.

### GET /api/skills/{id}/status
Get skill status.

### DELETE /api/skills/{id}
Remove skill.

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
