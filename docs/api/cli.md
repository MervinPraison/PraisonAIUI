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
