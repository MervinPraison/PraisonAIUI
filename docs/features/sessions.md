# Session Management

> PraisonAIUI provides full session management for chat conversations — create, switch, view history, and delete sessions.

PraisonAIUI provides full session management for chat conversations — create, switch, view history, and delete sessions.

## Quick Start

```bash
# Sessions persist by default (the praisonaiagents session store)
aiui run app.py

# Plain JSON files in ~/.praisonaiui/sessions/
aiui run app.py --datastore json
```

## Data Persistence Options

| Mode | Flag | Where |
|------|------|-------|
| SDK (default) | `--datastore sdk` | The praisonaiagents session store, shared with PraisonAI agents; falls back to `json` when `praisonaiagents` is not installed |
| SDK (custom path) | `--datastore sdk:/path/to/dir` | That directory |
| JSON files | `--datastore json` | `$AIUI_DATA_DIR/sessions/` (default `~/.praisonaiui/sessions/`) |
| JSON (custom path) | `--datastore json:/path/to/dir` | That directory |
| Memory | `--datastore memory` | Lost on restart; for tests |
| SQL | `aiui.set_datastore(aiui.SQLAlchemyDataStore(url))` | SQLite (`~/.praisonaiui/aiui.db` by default) or PostgreSQL; install `aiui[sql]` or `aiui[postgres]`. SQLAlchemy is imported only when this store first opens its database |
| Your own | Implement `BaseDataStore` | Your database |

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

## Feedback

Chat thumbs up/down (`POST /api/feedback`, listed with totals by
`GET /api/feedback`) is kept by every store:

| Store | Where votes go |
|-------|----------------|
| SDK (default) | `feedback/feedback.jsonl` in the session folder (`~/.praisonai/sessions/` by default) |
| JSON files | `feedback/feedback.jsonl` in the session folder; an older `feedback.json` is moved into it on start |
| SQL | The `feedback` table |
| Memory | Memory (lost on restart) |
| Your own `BaseDataStore` | `$AIUI_DATA_DIR/feedback/feedback.jsonl` unless you override `record_feedback` and `list_feedback`, or `feedback_file()` to move the file |

The file stores append one JSON line per vote, so a vote never rewrites the
earlier ones. Turn the buttons off with `aiui.set_feedback_enabled(False)`.

## Custom Data Store

Implement `BaseDataStore` for any database (SQLite, PostgreSQL, Redis, MongoDB, etc.):

```python
from praisonaiui.datastore import BaseDataStore

class PostgresDataStore(BaseDataStore):
    # The six session/message methods are abstract; update_session, close,
    # count_sessions (len(list_sessions()) by default; override it when the
    # database can count) and the feedback methods have defaults (votes go
    # to a JSON-lines file; see Feedback above).
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
import praisonaiui as aiui

store = PostgresDataStore("postgresql://user:pass@localhost/db")
aiui.set_datastore(store)
```

## Backend Modes

| Mode | Command | Session source |
|------|---------|----------------|
| Standalone (default) | `aiui run app.py` | The datastore above |
| PraisonAI | `aiui run app.py --backend praisonai` | The `WebSocketGateway` of the praisonai package |

## Related pages

- [Gateway Chat](https://ui.praison.ai/docs/features/gateway-chat.md)
- [Sessions API Reference](https://ui.praison.ai/docs/api/sessions.md)
- [CLI Usage](https://ui.praison.ai/docs/getting-started/cli.md)
