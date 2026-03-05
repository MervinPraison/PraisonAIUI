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
aiui schedule list                    # List all jobs
aiui schedule add <NAME> <MESSAGE> [--every 60]  # Add interval job
aiui schedule remove <JOB_ID>        # Remove job
aiui schedule status                  # Show scheduler status
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
