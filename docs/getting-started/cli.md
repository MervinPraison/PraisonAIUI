# CLI Reference

Complete reference for the `aiui` command-line interface.

## Core Commands

### `aiui run`

**The primary command** — run an AI server with your `app.py` or `chat.yaml`.

```bash
aiui run <FILE> [OPTIONS]
```

| Option | Description | Default |
|--------|-------------|---------|
| `FILE` | Python file (`app.py`) or YAML config (`chat.yaml`) | required |
| `--port, -p` | Server port | `8000` |
| `--host` | Bind address | `127.0.0.1` |
| `--reload` | Auto-reload on file changes | `false` |
| `--style, -s` | UI style: chat, dashboard, agents, playground, docs, custom | `chat` |
| `--backend` | AI backend: `praisonai`, `default` | `default` |
| `--workers` | Number of workers | `1` |
| `--ssl-certfile` | SSL certificate for HTTPS | — |
| `--ssl-keyfile` | SSL private key for HTTPS | — |

**Examples:**
```bash
aiui run app.py                          # Chat mode on port 8000
aiui run app.py --style dashboard        # Dashboard mode
aiui run app.py --port 3000 --reload     # Custom port with hot-reload
aiui run chat.yaml                       # YAML-defined chat agent
aiui run app.py --backend praisonai      # Use PraisonAI WebSocketGateway
```

---

### `aiui init`

Initialize a new PraisonAIUI project.

```bash
aiui init [OPTIONS]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--template, -t` | Template: minimal, docs, marketing | `minimal` |
| `--force, -f` | Overwrite existing files | `false` |
| `--frontend` | Scaffold full Vite + React + shadcn project | `false` |

**Examples:**
```bash
aiui init                        # Minimal project
aiui init --template docs        # Documentation site template
aiui init --frontend             # Full React frontend scaffold
```

---

### `aiui validate`

Validate your configuration file.

```bash
aiui validate [OPTIONS]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--config, -c` | Path to config file | `aiui.template.yaml` |
| `--strict` | Enable strict validation | `false` |

---

### `aiui build`

Build manifests from configuration (for docs/static site mode).

```bash
aiui build [OPTIONS]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--config, -c` | Path to config file | `aiui.template.yaml` |
| `--output, -o` | Output directory | `aiui` |
| `--minify` | Minify JSON output | `false` |

---

### `aiui serve`

Serve the built site locally with a production-ready HTTP server.

```bash
aiui serve [OPTIONS]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--config, -c` | Path to config file | `aiui.template.yaml` |
| `--port, -p` | Server port | `8000` |
| `--host` | Bind address | `127.0.0.1` |
| `--reload` | Watch for changes and rebuild | `false` |
| `--style, -s` | UI style override | auto-detected |
| `--ssl-certfile` | SSL certificate for HTTPS | — |
| `--ssl-keyfile` | SSL private key for HTTPS | — |

---

### `aiui dev`

Development dashboard — switch between examples live.

```bash
aiui dev [OPTIONS]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--examples, -e` | Directory containing example projects | `examples` |
| `--port, -p` | Port for dev server | `9000` |

---

### `aiui doctor`

Run structured diagnostics against a running AIUI server.

```bash
aiui doctor [OPTIONS]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--server, -s` | Server URL to diagnose | `http://127.0.0.1:8000` |
| `--json` | Output results as JSON | `false` |

Checks: health, provider, gateway, features, config, datastore, channels.

---

### `aiui test`

Run integration tests against a running server.

```bash
aiui test <SUITE>
```

| Suite | Description |
|-------|-------------|
| `chat` | Chat WebSocket send/receive |
| `memory` | Memory CRUD operations |
| `sessions` | Session management |
| `endpoints` | API endpoint availability |
| `all` | Run all test suites |

---

## Management Commands

All management commands connect to a running server (default `http://127.0.0.1:8000`). Use `--server URL` to target a different server.

### `aiui sessions`

```bash
aiui sessions list                          # List all sessions
aiui sessions create                        # Create new session
aiui sessions get <SESSION_ID>              # Get session details
aiui sessions delete <SESSION_ID>           # Delete session
aiui sessions messages <SESSION_ID>         # Get message history
```

### `aiui memory`

```bash
aiui memory list [--type short|long|entity|all]   # List memories
aiui memory add "Remember this" [--type long]     # Add memory
aiui memory search "query" [--limit 10]           # Search memories
aiui memory clear [--type all]                    # Clear memories
aiui memory status                                # Memory backend status
aiui memory context "query" [--limit 5]           # Get context for prompt
```

### `aiui skills`

```bash
aiui skills list        # List all skills
aiui skills status      # Show skills status
aiui skills discover    # Discover available skills
```

### `aiui provider`

```bash
aiui provider status    # Show active provider info
aiui provider health    # Check provider health
aiui provider agents    # List agents from provider
```

### `aiui config`

```bash
aiui config get [KEY]            # Get config (empty = show all)
aiui config set KEY VALUE        # Set a config value
aiui config list                 # List all config keys
aiui config history [--limit 20] # Show change history
```

### `aiui schedule`

```bash
aiui schedule list                                     # List scheduled jobs
aiui schedule add "job-name" "message" [--every 60]    # Add job (seconds)
aiui schedule remove <JOB_ID>                          # Remove job
aiui schedule status                                   # Scheduler status
```

### `aiui approval`

```bash
aiui approval list [--status pending|resolved|all]     # List approvals
aiui approval pending                                  # Pending count
aiui approval resolve <ID> [--approved|--denied] [--reason "..."]
```

### `aiui workflows`

```bash
aiui workflows list                # List workflows
aiui workflows run <WORKFLOW_ID>   # Run a workflow
aiui workflows status              # Workflow status
aiui workflows runs                # Run history
```

### `aiui hooks`

```bash
aiui hooks list                    # List all hooks
aiui hooks trigger <HOOK_ID>       # Trigger a hook
aiui hooks log [--limit 20]        # Hook execution log
```

### `aiui eval`

```bash
aiui eval status                                         # Eval status
aiui eval list [--limit 20] [--agent-id ID]              # List evaluations
aiui eval scores                                         # Scores by agent
aiui eval judges                                         # List judges
aiui eval run --input "..." --output "..." [--expected "..."]  # Run eval
```

### `aiui traces`

```bash
aiui traces status                              # Tracing status
aiui traces list [--limit 20]                   # List traces
aiui traces spans [--limit 20] [--trace-id ID]  # List spans
aiui traces get <TRACE_ID>                      # Get trace details
```

### `aiui pages`

```bash
aiui pages list    # List all sidebar pages (with groups, icons)
aiui pages ids     # Print page IDs (useful for set_pages() whitelist)
```

### `aiui features`

```bash
aiui features list     # List all registered features
aiui features status   # Feature health summary
```

### `aiui health`

```bash
aiui health [--detailed]    # Check server health
```

### `aiui session-ext`

Extended session operations:

```bash
aiui session-ext state <SESSION_ID>                          # Get session state
aiui session-ext save-state <SESSION_ID> --key K --value V   # Save state
aiui session-ext labels <SESSION_ID>                         # Get labels
aiui session-ext usage <SESSION_ID>                          # Usage stats
aiui session-ext compact <SESSION_ID>                        # Compact context
aiui session-ext reset <SESSION_ID>                          # Reset state
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Configuration error |
| `2` | File not found |
| `3` | Build error |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key | — |
| `PRAISONAI_MODEL` | Default model | `gpt-4o-mini` |
| `AIUI_DATA_DIR` | Data directory | `~/.praisonaiui` |
| `AIUI_CONFIG` | Config file path | `aiui.template.yaml` |
| `AIUI_OUTPUT` | Build output dir | `aiui` |
