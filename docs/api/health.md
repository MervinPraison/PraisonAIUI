# Health API Reference

The AIUI health API provides endpoints to monitor server and provider health status.

## Health Status Values

The following status values are used throughout the health API:

| Status | Meaning | Color Code |
|--------|---------|------------|
| `"ok"` | Service is functioning normally | Green |
| `"healthy"` | Service is functioning normally (legacy) | Green |
| `"degraded"` | Service is partially functional | Yellow |
| `"error"` | Service has errors | Red |
| `"unknown"` | Status cannot be determined | Yellow |

> **Note:** Both `"ok"` and `"healthy"` indicate successful operation. The system accepts either value for backward compatibility.

## Endpoints

### GET /health

Returns the overall server health status.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-06-23T10:00:00Z",
  "integrated": true,
  "sdk_gaps": []
}
```

### GET /api/provider

Returns information about the active AI provider.

**Response:**
```json
{
  "name": "PraisonAIProvider",
  "module": "praisonaiui.providers",
  "status": "ok",
  "agents": []
}
```

### GET /api/provider/health

Returns detailed JSON health information from the provider gateway. Always
responds with `Content-Type: application/json`. The base fields from the
provider's `health()` payload are merged with the normalised fields below.

**Response:**
```json
{
  "status": "ok",
  "provider": "PraisonAIProvider",
  "type": "PraisonAIProvider",
  "agents": 5,
  "detail": "ok"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | One of the health status values above. |
| `type` | string | Provider type (from `provider` field, falls back to class name). |
| `agents` | integer | Count of agents reported by the provider. |
| `detail` | string | Human-readable detail; `"ok"` for healthy providers. |

> **Note:** Any unmatched `/api/*` path returns a JSON `404` (never the SPA
> HTML shell), so API clients can rely on parsing the response body.

## CLI Commands

### health-check

Check server health status:

```bash
aiui health-check --server http://127.0.0.1:8000
```

The command displays:
- Green panel for `"ok"` or `"healthy"` status
- Yellow panel for other statuses
- Red error message if server is unreachable

### doctor

Run comprehensive diagnostics:

```bash
aiui doctor --server http://127.0.0.1:8000
```

The doctor command checks:
1. Server Health
2. Provider Status
3. Gateway Status
4. Features Loaded
5. Config Store
6. Datastore
7. Channels

### provider status

Check provider health:

```bash
aiui provider status --server http://127.0.0.1:8000
```

## Python API

```python
from praisonaiui.health_utils import is_success_status

# Check if a status indicates success
if is_success_status("ok"):
    print("Service is healthy")

# Available success statuses
from praisonaiui.health_utils import SUCCESS_STATUSES
# frozenset({'ok', 'healthy'})
```

## JavaScript/Dashboard

The dashboard automatically accepts both `"ok"` and `"healthy"` as success statuses:

```javascript
const ok = d && (d.status === 'ok' || d.status === 'healthy');
```