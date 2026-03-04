# Session Management

PraisonAIUI provides full session management for chat conversations — create, switch, view history, and delete sessions.

## Quick Start

```bash
# Start server with persistent sessions
aiui run app.py --datastore json

# Sessions persist to ~/.praisonaiui/sessions/
```

## Data Persistence Options

| Mode | Flag | Persists? | Best For |
|------|------|-----------|----------|
| Memory | `--datastore memory` (default) | ❌ Lost on restart | Development, testing |
| JSON Files | `--datastore json` | ✅ `~/.praisonaiui/sessions/` | Single-user, local |
| JSON (custom path) | `--datastore json:/path/to/dir` | ✅ Custom directory | Custom setups |
| Custom DB | Implement `BaseDataStore` | ✅ Your database | Production |

## REST API

### List Sessions
```bash
curl http://127.0.0.1:8000/sessions
```

### Create Session
```bash
curl -X POST http://127.0.0.1:8000/sessions
```

### Get Session Details
```bash
curl http://127.0.0.1:8000/sessions/<session_id>
```

### Get Message History
```bash
curl http://127.0.0.1:8000/sessions/<session_id>/runs
```

### Delete Session
```bash
curl -X DELETE http://127.0.0.1:8000/sessions/<session_id>
```

### Send Message
```bash
curl -X POST http://127.0.0.1:8000/run \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello", "session_id":"<session_id>"}'
```

## CLI Commands

Every API endpoint has a CLI equivalent:

```bash
aiui sessions list                    # List all sessions
aiui sessions create                  # Create a new session
aiui sessions get <session_id>        # Get session details
aiui sessions messages <session_id>   # View message history
aiui sessions delete <session_id>     # Delete a session
aiui health-check                     # Server health check
```

Use `--server` to target a different server:
```bash
aiui sessions list --server http://localhost:3000
```

## Custom Data Store

Implement `BaseDataStore` for any database (SQLite, PostgreSQL, Redis, MongoDB, etc.):

```python
from praisonaiui.datastore import BaseDataStore

class PostgresDataStore(BaseDataStore):
    def __init__(self, dsn: str):
        self.dsn = dsn
        # ... set up connection pool

    async def list_sessions(self) -> list[dict]:
        # SELECT id, created_at, updated_at, message_count FROM sessions
        ...

    async def get_session(self, session_id: str) -> dict | None:
        # SELECT * FROM sessions WHERE id = ?
        ...

    async def create_session(self, session_id: str = None) -> dict:
        # INSERT INTO sessions ...
        ...

    async def delete_session(self, session_id: str) -> bool:
        # DELETE FROM sessions WHERE id = ?
        ...

    async def add_message(self, session_id: str, message: dict) -> None:
        # INSERT INTO messages ...
        ...

    async def get_messages(self, session_id: str) -> list[dict]:
        # SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp
        ...

    async def close(self) -> None:
        # Close connection pool
        ...
```

Register before the server starts:

```python
# In your app.py:
from praisonaiui.server import set_datastore

store = PostgresDataStore("postgresql://user:pass@localhost/db")
set_datastore(store)
```

## Backend Modes

| Mode | Command | Transport | Session Source |
|------|---------|-----------|---------------|
| Standalone (default) | `aiui run app.py` | SSE over HTTP | DataStore |
| PraisonAI | `aiui run app.py --backend praisonai` | WebSocket | WebSocketGateway |

In **standalone** mode, sessions are managed by the configurable DataStore.
In **praisonai** mode, sessions are managed by the `WebSocketGateway` from the praisonai package.
