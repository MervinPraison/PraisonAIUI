# Deployment Guide

Production deployment guide for AIUI — covering Docker, environment variables, configuration, and security.

## Quick Start (Docker)

### Build the Image

```bash
cd /path/to/PraisonAIUI
docker build -t aiui:latest .
```

### Run with Default Settings

```bash
docker run -d \
  --name aiui \
  -p 8082:8082 \
  -e OPENAI_API_KEY=sk-... \
  aiui:latest
```

### Run with Custom Data Directory

```bash
docker run -d \
  --name aiui \
  -p 8082:8082 \
  -v /path/to/data:/data \
  -e AIUI_DATA_DIR=/data \
  -e OPENAI_API_KEY=sk-... \
  aiui:latest
```

### Docker Compose Example

```yaml
version: '3.8'
services:
  aiui:
    build: .
    ports:
      - "8082:8082"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - AIUI_DATA_DIR=/data
      - AUTH_ENFORCE=true
    volumes:
      - aiui-data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8082/health"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  aiui-data:
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AIUI_DATA_DIR` | `~/.praisonaiui` | Data directory for config, sessions, logs |
| `AIUI_PORT` | `8082` | Server port (Docker only) |
| `AIUI_HOST` | `0.0.0.0` | Server bind address (Docker only) |
| `AUTH_ENFORCE` | `false` | Enforce Bearer token auth on `/api/*` routes |
| `OPENAI_API_KEY` | — | OpenAI API key for LLM provider |

### Auth Enforcement

When `AUTH_ENFORCE=true`, all `/api/*` routes require a valid Bearer token in the `Authorization` header:

```bash
# Without AUTH_ENFORCE (default): open access
curl http://localhost:8082/api/config

# With AUTH_ENFORCE=true: requires auth
curl -H "Authorization: Bearer <api-key>" http://localhost:8082/api/config
```

**Exempt paths** (always accessible without auth):
- `/health`, `/api/health` — health checks
- `/api/auth/login`, `/login` — login endpoints
- `/api/protocol`, `/api/protocol/negotiate` — protocol discovery

## Configuration

### Config File Location

The config file is located at `AIUI_DATA_DIR/config.yaml` (default: `~/.praisonaiui/config.yaml`).

### Config Structure

```yaml
schemaVersion: 2

# Site customization
site:
  title: "My Custom UI"  # Appears in HTML <title> and UI header

# Server settings
server:
  host: "127.0.0.1"
  port: 8003

# AI Provider
provider:
  name: "openai"
  model: "gpt-4o-mini"

# Gateway settings
gateway:
  host: "127.0.0.1"
  port: 8765

# Agents (managed via /api/agents)
agents: {}

# Skills (managed via /api/skills)
skills:
  enabled: []
  custom: {}

# Channels (managed via /api/channels)
channels: {}
```

### Site Title Customization

The site title is configurable via `site.title` in config.yaml:

```yaml
site:
  title: "AIUI"  # Default
```

This affects:
- HTML `<title>` tag
- Dashboard header
- `/ui-config.json` response

## Health Monitoring

### Health Endpoint

```bash
curl http://localhost:8082/health
# Returns: {"status": "healthy", "timestamp": "2024-..."}
```

### Docker HEALTHCHECK

The Dockerfile includes a built-in health check:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${AIUI_PORT}/health || exit 1
```

### CLI Health Commands

```bash
# Quick health check
aiui health --server http://localhost:8082

# Detailed per-feature health
aiui health --server http://localhost:8082 --detailed

# Full diagnostic (7 checks)
aiui doctor --server http://localhost:8082
```

## Security

### Auth Modes

AIUI supports multiple authentication modes:

| Mode | Description |
|------|-------------|
| `none` | No authentication (default) |
| `api_key` | API key in `X-API-Key` header or `api_key` query param |
| `session` | Session token in `Authorization: Bearer <token>` header |
| `password` | Username/password login |

### API Key Management

```bash
# Create an API key (via CLI)
aiui auth create-key --name "my-app"

# Use the key
curl -H "X-API-Key: <key>" http://localhost:8082/api/config
```

### Network Considerations

- **Internal networks**: Use `AUTH_ENFORCE=false` if behind a trusted reverse proxy
- **Public exposure**: Always set `AUTH_ENFORCE=true` and use HTTPS
- **Load balancers**: Health check path is `/health` (exempt from auth)

## Managed Hosting

### Required Endpoints

Hosting platforms should expose these endpoints:

| Endpoint | Purpose |
|----------|---------|
| `/health` | Health check (returns `{"status": "healthy"}`) |
| `/api/protocol` | Protocol version and capabilities |
| `/api/protocol/negotiate` | Capability negotiation |
| `/api/features` | List of registered features |

### Protocol Discovery

```bash
# Get protocol version
curl http://localhost:8082/api/protocol
# Returns: {"version": "1.0", "capabilities": [...]}

# List features
curl http://localhost:8082/api/features
# Returns: {"features": [{"name": "chat", ...}, ...]}
```

### Minimum Viable Deployment

For a minimal AIUI deployment:

1. **Required**: `OPENAI_API_KEY` environment variable
2. **Recommended**: Persistent volume for `AIUI_DATA_DIR`
3. **Optional**: `AUTH_ENFORCE=true` for multi-tenant environments

```bash
docker run -d \
  -p 8082:8082 \
  -e OPENAI_API_KEY=sk-... \
  -v aiui-data:/root/.praisonaiui \
  aiui:latest
```
