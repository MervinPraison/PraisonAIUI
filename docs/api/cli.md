# CLI API Reference

Complete reference for the `aiui` Python CLI.

## Commands

### init

Initialize a new project.

```bash
aiui init [OPTIONS]
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--template, -t` | string | `minimal` | Template: minimal, docs, marketing |
| `--force, -f` | flag | `false` | Overwrite existing files |

### validate

Validate configuration file.

```bash
aiui validate [OPTIONS]
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--config, -c` | path | `aiui.template.yaml` | Config file path |
| `--strict` | flag | `false` | Strict validation mode |

### build

Build manifests from configuration.

```bash
aiui build [OPTIONS]
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--config, -c` | path | `aiui.template.yaml` | Config file path |
| `--output, -o` | path | `aiui` | Output directory |
| `--minify` | flag | `false` | Minify JSON output |

### dev

Start development mode with file watching.

```bash
aiui dev [OPTIONS]
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--config, -c` | path | `aiui.template.yaml` | Config file path |
| `--port, -p` | int | `3000` | Dev server port |

### run

Run the AI chat server with your app or config.

```bash
aiui run <APP_FILE> [OPTIONS]
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--port, -p` | int | `8000` | Server port |
| `--host` | string | `127.0.0.1` | Host to bind to |
| `--reload, -r` | flag | `false` | Auto-reload on file changes |
| `--style, -s` | string | `chat` | UI style: `chat`, `docs`, `agents`, `playground`, `dashboard`, `custom` |
| `--backend, -b` | string | `standalone` | Backend: `standalone` or `praisonai` |
| `--datastore, -d` | string | `memory` | Data persistence: `memory`, `json`, `json:/path` |
| `--output, -o` | path | `aiui` | Output directory for static files |

**Style auto-detection:** When `--style` is not provided, the style is automatically detected from your code. See [Styles](../features/styles.md) for details.

```bash
# Auto-detects style from code
aiui run app.py

# Explicit style
aiui run app.py --style agents

# With persistence
aiui run app.py --datastore json

# YAML config
aiui run chat.yaml
```

## Python API

### Direct Usage

```python
from praisonaiui import Config
from praisonaiui.compiler import Compiler

# Load and validate config
config = Config.from_yaml("aiui.template.yaml")

# Build manifests
compiler = Compiler(config)
result = compiler.compile()

# Access outputs
print(result.ui_config)
print(result.docs_nav)
print(result.route_manifest)
```

### Schema Models

```python
from praisonaiui.schema import (
    Config,
    SiteConfig,
    ContentConfig,
    TemplateConfig,
    RouteConfig,
)
```

---

## Feature Commands

All feature commands talk to a running PraisonAIUI server (default: `http://127.0.0.1:8000`). Use `--server` / `-s` to override.

### features

```bash
aiui features list                    # List all registered protocol features
```

### approval

```bash
aiui approval list [--status pending|resolved|all]  # List approvals
aiui approval pending                               # Show pending count
aiui approval resolve <ID> [--approved/--denied] [--reason TEXT]
```

### schedule

```bash
aiui schedule list                    # List all jobs (shows delivery + agent info)
aiui schedule add <NAME> <MESSAGE> [OPTIONS]  # Add a scheduled job
aiui schedule remove <JOB_ID>        # Remove job
aiui schedule status                  # Show scheduler status
```

**Schedule add options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--every` | int | `60` | Interval in seconds |
| `--cron` | string | | Cron expression (e.g. `*/5 * * * *`) |
| `--channel` | string | | Delivery channel (e.g. `telegram`, `slack`) |
| `--channel-id` | string | | Delivery channel/room ID |
| `--agent-id` | string | | Agent to handle the job |
| `--session-target` | string | `isolated` | Session: `isolated` or `main` |

```bash
# Simple interval job
aiui schedule add "Daily Report" "Generate summary" --every 86400

# Cron job with delivery
aiui schedule add "Slack Update" "Post metrics" \
  --cron "0 9 * * 1-5" \
  --channel slack --channel-id C123456 \
  --agent-id analyst
```

### guardrails

```bash
aiui guardrails list                  # List all registered guardrails
aiui guardrails add --description "Block profanity" [OPTIONS]  # Register guardrail
aiui guardrails remove <GUARDRAIL_ID> # Remove a guardrail
aiui guardrails status                # Show system status
aiui guardrails violations [--limit 20]  # Show recent violations
```

**Guardrails add options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--description` | string | *required* | Natural language validation criteria |
| `--type` | string | `llm` | Guardrail type: `llm` or `custom` |
| `--agent-name` | string | | Target agent (all agents if empty) |
| `--llm-model` | string | `gpt-4o-mini` | LLM model for evaluation |

### knowledge

```bash
aiui knowledge list                   # List all knowledge entries
aiui knowledge add <TEXT> [--agent-id ID] [--user-id ID]  # Store entry
aiui knowledge search <QUERY> [--limit 10]  # Search knowledge base
aiui knowledge remove <ENTRY_ID>      # Delete an entry
aiui knowledge status                 # Show backend info + stats
```

### security

```bash
aiui security status                  # Show security posture
aiui security audit [--limit 20]      # Show audit log entries
aiui security config                  # Show security configuration
```

### telemetry

```bash
aiui telemetry status                 # Show telemetry status
aiui telemetry metrics [--limit 20] [--agent-id ID]  # Show recent metrics
aiui telemetry overview               # Aggregate stats with per-agent breakdown
```

### memory

```bash
aiui memory list [--type short|long|entity|all]  # List memories
aiui memory add <TEXT> [--type long]             # Add memory
aiui memory search <QUERY> [--limit 10]          # Search
aiui memory clear [--type all]                   # Clear memories
aiui memory status                               # Memory stats
```

### skills

```bash
aiui skills list                      # List all skills
aiui skills status                    # Show skills count
aiui skills discover                  # Discover available skills
```

### hooks

```bash
aiui hooks list                       # List all hooks
aiui hooks trigger <HOOK_ID>          # Trigger a hook
aiui hooks log [--limit 20]           # View execution log
```

### workflows

```bash
aiui workflows list                   # List all workflows
aiui workflows run <WORKFLOW_ID>      # Run a workflow
aiui workflows status                 # Show workflow count
aiui workflows runs                   # List run history
```

### config

```bash
aiui config get [KEY]                 # Get config (all or single key)
aiui config set <KEY> <VALUE>         # Set a config value
aiui config list                      # List all config keys
aiui config history [--limit 20]      # Show change history
```

### provider

```bash
aiui provider status                  # Show provider info + health
aiui provider health                  # Check provider health
aiui provider agents                  # List agents
```

### health-check

```bash
aiui health-check [--server URL]      # Check server health
```
