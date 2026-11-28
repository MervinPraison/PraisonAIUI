# API Testing Guide

> Exercise the feature APIs with curl. Each example creates real data on a

Exercise the feature APIs with curl. Each example creates real data on a
running server.

## Quick Start

Start any app on port 8082 (the port `aiui test` uses by default), for example
[`examples/python/01-chat`](https://github.com/MervinPraison/PraisonAIUI/blob/main/examples/python/01-chat/app.py):

```bash
aiui run app.py --port 8082
```

Replace `{id}`-style placeholders with an id returned by the create call. The
server binds to `127.0.0.1`; see [Deployment](https://ui.praison.ai/docs/features/deployment.md)
before exposing it.

---

## 1. Channels

```bash
# Create a channel
curl -X POST http://localhost:8082/api/channels \
  -H "Content-Type: application/json" \
  -d '{"name":"Discord #general","platform":"discord","config":{"guild":"123"}}'
# → 201 Created, returns {"id":"...","name":"Discord #general",...}

# List channels
curl http://localhost:8082/api/channels
# → 200 OK, returns {"channels":[...],"count":1}

# Get single channel
curl http://localhost:8082/api/channels/{id}

# Update channel
curl -X PUT http://localhost:8082/api/channels/{id} \
  -H "Content-Type: application/json" \
  -d '{"enabled":false}'
```

## 2. Agents

```bash
# Define an agent
curl -X POST http://localhost:8082/api/agents/definitions \
  -H "Content-Type: application/json" \
  -d '{"name":"Research Agent","instructions":"You research topics","model":"gpt-4o-mini"}'
# → 201 Created

# List agents
curl http://localhost:8082/api/agents/definitions

# List available models
curl http://localhost:8082/api/agents/models
# → 200 OK, returns {"models":[...],"default":"gpt-4o-mini"}

# Run an agent (requires praisonaiagents installed)
curl -X POST http://localhost:8082/api/agents/run/{agent_id} \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Say hello in 3 words"}'
```

## 3. Approvals

```bash
# Create a high-risk approval request
curl -X POST http://localhost:8082/api/approvals \
  -H "Content-Type: application/json" \
  -d '{"tool_name":"execute_command","arguments":{"cmd":"ls"},"risk_level":"high","agent_name":"SysAgent"}'
# → 201 Created, status: "pending"

# Create a low-risk request (auto-approved)
curl -X POST http://localhost:8082/api/approvals \
  -H "Content-Type: application/json" \
  -d '{"tool_name":"web_search","arguments":{"q":"AI"},"risk_level":"low","agent_name":"SearchBot"}'
# → 201 Created, status: "approved" (auto)

# Check pending approvals
curl http://localhost:8082/api/approvals/pending

# Approve a request
curl -X POST http://localhost:8082/api/approvals/{id}/approve \
  -H "Content-Type: application/json" \
  -d '{"reason":"Reviewed safe"}'

# View approval policies and history
curl http://localhost:8082/api/approvals/policies
curl http://localhost:8082/api/approvals/history
```

## 4. Jobs

```bash
# Submit a job
curl -X POST http://localhost:8082/api/jobs \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Analyze AI trends","config":{"model":"gpt-4o-mini"}}'
# → 202 Accepted, returns {"job_id":"run_...","status":"queued","poll_url":...,"stream_url":...}

# List jobs
curl http://localhost:8082/api/jobs

# Get job statistics
curl http://localhost:8082/api/jobs/stats
# → {"total_jobs":1,"status_counts":{"running":1},...}
```

## 5. Schedules

```bash
# Create a schedule
curl -X POST http://localhost:8082/api/schedules \
  -H "Content-Type: application/json" \
  -d '{"name":"Daily Report","schedule":{"kind":"every","every_seconds":86400},"message":"Generate report"}'
# → 201 Created

# List schedules
curl http://localhost:8082/api/schedules
```

## 6. Usage

```bash
# Track usage
curl -X POST http://localhost:8082/api/usage/track \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","input_tokens":500,"output_tokens":200}'
# → 201 Created

# Get summary (includes by_model breakdown)
curl http://localhost:8082/api/usage
# → {"total_requests":1,"total_tokens":700,"total_cost_usd":...,...}

# Cost table
curl http://localhost:8082/api/usage/costs
# → {"cost_table":{...},"currency":"USD","unit":"per 1K tokens"}

# Additional endpoints
curl http://localhost:8082/api/usage/models     # Per-model breakdown
curl http://localhost:8082/api/usage/sessions   # Per-session breakdown
curl http://localhost:8082/api/usage/timeseries  # Time-series chart data
```

## 7. Skills

```bash
# List all skills
curl http://localhost:8082/api/skills
# → {"skills":[...],"count":N}  (N depends on the installed PraisonAI tools)

# List by category
curl http://localhost:8082/api/skills/categories
# → {"categories":[{"name":"code","count":...},...]}
```

## 8. Config

```bash
# Get schema
curl http://localhost:8082/api/config/schema

# Get defaults
curl http://localhost:8082/api/config/defaults
# → {"defaults":{"provider":{"name":"openai"},"model":{"name":"gpt-4o-mini"},...}}

# Validate config
curl -X POST http://localhost:8082/api/config/validate \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai","model":"gpt-4o"}'
# → {"valid":true,...}

# Set runtime config
curl -X PATCH http://localhost:8082/api/config/runtime \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","temperature":"0.9"}'

# Get runtime config
curl http://localhost:8082/api/config/runtime

# Runtime config is saved to config.yaml in the data directory
# (~/.praisonaiui, or AIUI_DATA_DIR) and survives restarts.
```

## 9. Auth

```bash
# Check auth status
curl http://localhost:8082/api/auth/status
# → {"authenticated":true,"mode":"none","user":null}

# Get auth config
curl http://localhost:8082/api/auth/config

# Create API key
curl -X POST http://localhost:8082/api/auth/keys \
  -H "Content-Type: application/json" \
  -d '{"name":"CI/CD Pipeline","expires_days":90}'
# → {"key":"pk_...","name":"CI/CD Pipeline",...}

# List API keys
curl http://localhost:8082/api/auth/keys
```

## 10. OpenAI-Compatible API

```bash
# API info
curl http://localhost:8082/v1
# → {"endpoints":[...],"version":"..."}

# List models
curl http://localhost:8082/v1/models
# → {"data":[{"id":"gpt-4o","object":"model",...},...],"object":"list"}
```

## 11. Logs

```bash
# Get log levels
curl http://localhost:8082/api/logs/levels
# → {"levels":[{"name":"DEBUG"},{"name":"INFO"},...]}

# Get log stats
curl http://localhost:8082/api/logs/stats
```

## 12. Sessions

```bash
# Save session state
curl -X POST http://localhost:8082/api/sessions/test-session/state \
  -H "Content-Type: application/json" \
  -d '{"state":{"mood":"productive","topic":"AI","level":7}}'

# Retrieve session state
curl http://localhost:8082/api/sessions/test-session/state
# → {"state":{"mood":"productive","topic":"AI","level":7}}

# Preview session
curl http://localhost:8082/api/sessions/test-session/preview
```

## 13. Memory

```bash
# List all memories
curl http://localhost:8082/api/memory
# → {"memories":[],"count":0}

# Add a memory (the first call can take a few seconds while the backend starts)
curl -X POST http://localhost:8082/api/memory \
  -H "Content-Type: application/json" \
  -d '{"text":"User prefers dark mode","memory_type":"preference"}'

# Search memories
curl -X POST http://localhost:8082/api/memory/search \
  -H "Content-Type: application/json" \
  -d '{"query":"dark mode"}'

# Get memory context for a prompt
curl -X POST http://localhost:8082/api/memory/context \
  -H "Content-Type: application/json" \
  -d '{"query":"what theme does user prefer?"}'

# List memories for a specific session
curl http://localhost:8082/api/memory/session/{session_id}
# → {"memories":[...],"count":0,"session_id":"..."}

# Memory backend status and health
curl http://localhost:8082/api/memory/status
# → {"total":0,"by_type":{},"backend":"...","status":"ok"}

# Get a specific memory
curl http://localhost:8082/api/memory/{memory_id}

# Delete a specific memory
curl -X DELETE http://localhost:8082/api/memory/{memory_id}

# Clear all memories
curl -X DELETE http://localhost:8082/api/memory
```

## 14–15. Hooks, Workflows

```bash
# These return empty lists until data is created through agent execution
curl http://localhost:8082/api/hooks
curl http://localhost:8082/api/workflows
```

## 16. Features (Meta)

```bash
# List all registered features
curl http://localhost:8082/api/features
# → {"features":[...],"count":N}
```

---

## CLI Integration Tests (`aiui test`)

PraisonAIUI includes built-in integration tests via
`aiui test`. These run against a live server and verify chat, memory, sessions,
and API endpoint health.

### Quick Start

```bash
# Start the server
aiui run app.py --port 8082

# In another terminal, run all tests
aiui test all --server http://127.0.0.1:8082
```

### Available Subcommands

| Command | What it tests |
|---------|---------------|
| `aiui test endpoints` | That the feature endpoints answer: health, features, sessions, chat, provider, channels, agents, config, skills, memory, schedules, approvals, auth, knowledge, guardrails, i18n, telemetry, security, logs, usage and more |
| `aiui test features` | Create, read, update and delete for guardrails, knowledge, memory, workflows, channels and eval |
| `aiui test chat` | Sends messages, checks the reply lands in the session history and that two sessions stay separate |
| `aiui test memory` | Stores a fact in one session and recalls it in another (recall is skipped, not failed, when the fact is stored but the model does not use it) |
| `aiui test sessions` | The session is persisted in the server's datastore (`GET /sessions/{id}`, any backend or `AIUI_DATA_DIR`) |
| `aiui test all` | All of the above in sequence |

The only option is `--server` / `-s` (default `http://127.0.0.1:8082`).
`chat` and `memory` need an app that replies with a model.

Each suite prints one line per check and a summary box, for example
`34 passed, 0 failed, 1 skipped` for `endpoints`; optional checks such as
`GET /api/provider/agents` are skipped when the provider does not offer them.

---

## Running the Full API Test Suite

[`examples/python/14-all-features/app.py`](https://github.com/MervinPraison/PraisonAIUI/blob/main/examples/python/14-all-features/app.py)
calls 16 feature APIs in-process with Starlette's `TestClient` (no server
needed), then runs one real agent call, which needs `OPENAI_API_KEY`:

```bash
cd examples/python/14-all-features
pip install httpx  # if not installed
python app.py
```

## Expected Results

| Feature | Expected |
|---------|----------|
| Channels | 201 create, 200 list, get and update |
| Agents | 201 create, 200 list and models; run needs `praisonaiagents` |
| Approvals | Low-risk requests are approved automatically, high-risk ones stay pending |
| Jobs | 202 submit, 200 list and stats |
| Schedules | 201 create, 200 list |
| Usage | 201 track, 200 summary, costs, models, sessions, timeseries |
| Skills | 200 list and categories |
| Config | Schema, defaults, validate, runtime set and get |
| Auth | Status, config, API key create and list |
| OpenAI-compatible API | `/v1` lists its endpoints, `/v1/models` the models |
| Logs | Levels and stats |
| Sessions | State save, get and preview |
| Memory | List, add, search, context, session-scoped, status |
| Hooks, Workflows | 200 with empty lists until something is registered |
| Features | The registered features with their health |

## Related pages

- [Feature Protocols](https://ui.praison.ai/docs/features/protocols.md)
- [Testing](https://ui.praison.ai/docs/testing.md)
- [Features REST API Reference](https://ui.praison.ai/docs/api/features-api.md)
