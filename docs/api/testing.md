# API Testing Guide

Test all 16 PraisonAIUI feature APIs using curl. Each example creates real data and verifies backend processing.

## Quick Start

```bash
# Start the server
cd /path/to/PraisonAIUI
PYTHONPATH=src python3 -c "
import uvicorn
from praisonaiui.server import create_app
app = create_app()
uvicorn.run(app, host='0.0.0.0', port=8082)
"
```

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
# → 200 OK, returns {"models":[...]} with 13 models (GPT, Claude, Gemini, O1/O3)

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
# → 202 Accepted, returns {"job_id":"run_...","status":"running"}

# List jobs
curl http://localhost:8082/api/jobs

# Get job statistics
curl http://localhost:8082/api/jobs/stats
# → {"total_jobs":1,"status_counts":{"running":1}}
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
# → {"total_requests":1,"usage":{"by_model":{"gpt-4o-mini":{...}}},...}

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
# → {"skills":[...],"count":18}

# List by category
curl http://localhost:8082/api/skills/categories
# → {"categories":[{"name":"code","count":3},{"name":"search","count":4},...]}
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
```

## 9. Auth

```bash
# Check auth status
curl http://localhost:8082/api/auth/status
# → {"mode":"none","authenticated":true,...}

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

## 13–15. Memory, Hooks, Workflows

```bash
# These return empty lists until data is created through agent execution
curl http://localhost:8082/api/memory
curl http://localhost:8082/api/hooks
curl http://localhost:8082/api/workflows
```

## 16. Features (Meta)

```bash
# List all registered features
curl http://localhost:8082/api/features
# → {"features":[...],"count":16}
```

---

## Running the Full Test Suite

Use the example at `examples/python/14-all-features/app.py` which tests all 16 features programmatically:

```bash
cd examples/python/14-all-features
pip install httpx  # if not installed
python app.py
```

## Expected Results

| Feature | Endpoints | Expected |
|---------|-----------|----------|
| Channels | 4 | All 200/201 |
| Agents | 3+ | 201 create, 200 list, 501 run (no praisonaiagents) |
| Approvals | 6 | Auto-approve low-risk, manual approve high-risk |
| Jobs | 3 | 202 submit, 200 list/stats |
| Schedules | 2 | 201 create, 200 list |
| Usage | 4+ | 201 track, 200 summary with by_model breakdown |
| Skills | 2 | 18 skills, 7 categories |
| Config | 5 | Schema, defaults, validate, runtime set/get |
| Auth | 4 | API key generation, multi-mode auth |
| OpenAI API | 2 | 11 endpoints, 13 models |
| Logs | 2 | 5 log levels |
| Sessions | 3 | State save/get/preview |
| Memory | 1 | 200 (empty until agents run) |
| Hooks | 1 | 200 (empty until registered) |
| Workflows | 1 | 200 (empty until created) |
| Features | 1 | 16 features registered |
