# CLI Usage

Complete reference for the `aiui` command-line interface.

## Commands

### `aiui init`

Initialize a new PraisonAIUI project.

```bash
aiui init [OPTIONS]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--template, -t` | Template: minimal, docs, marketing | `minimal` |
| `--force, -f` | Overwrite existing files | `false` |

**Example:**
```bash
aiui init --template docs
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

**Example:**
```bash
aiui validate --config my-config.yaml
```

---

### `aiui build`

Build manifests from configuration.

```bash
aiui build [OPTIONS]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--config, -c` | Path to config file | `aiui.template.yaml` |
| `--output, -o` | Output directory | `aiui` |
| `--minify` | Minify JSON output | `false` |

**Example:**
```bash
aiui build --output dist/aiui --minify
```

---

### `aiui dev`

Start development mode with file watching.

```bash
aiui dev [OPTIONS]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--config, -c` | Path to config file | `aiui.template.yaml` |
| `--port, -p` | Development server port | `3000` |

**Example:**
```bash
aiui dev --port 4000
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

| Variable | Description |
|----------|-------------|
| `AIUI_CONFIG` | Default config file path |
| `AIUI_OUTPUT` | Default output directory |
