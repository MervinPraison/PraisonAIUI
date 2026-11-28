# Session Management

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

## Where `aiui run` keeps chats

Each app has its own chat history. `aiui run app.py` stores the sessions of
that app file in
`~/.praisonaiui/apps/<file name>-<hash of its path>/sessions/` (under
`$AIUI_DATA_DIR` when it is set), so one app never lists the chats of
another app or agent on the machine, and nothing is written into the app's
own folder.

| You want | Run |
|---|---|
| This app's own history (default) | `aiui run app.py` |
| The history shared with every praisonai agent (`~/.praisonai/sessions/`, the old default) | `aiui run app.py --datastore sdk` |
| A folder you choose | `aiui run app.py --datastore sdk:/path` or `--datastore json:/path` |
| Nothing kept | `aiui run app.py --datastore memory` |

A YAML chat config (`aiui run chat.yaml`) keeps its `datastore:` key, and
without one uses the shared SDK store as before.

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
| SDK (default) | `feedback/feedback.jsonl` in the session folder (the app's own folder under `aiui run app.py`, else `~/.praisonai/sessions/`) |
| JSON files | `feedback/feedback.jsonl` in the session folder; an older `feedback.json` is moved into it on start |
| SQL | The `feedback` table |
| Memory | Memory (lost on restart) |
| Your own `BaseDataStore` | `$AIUI_DATA_DIR/feedback/feedback.jsonl` unless you override `record_feedback` and `list_feedback`, or `feedback_file()` to move the file |

The file stores append one JSON line per vote, so a vote never rewrites the
earlier ones. Turn the buttons off with `aiui.set_feedback_enabled(False)`.

## Thread Sharing

Create read-only share links for any conversation session with opaque 32-byte tokens. Access is **denied by default** until you register an access-control callback with `@aiui.on_shared_view` (alias `@aiui.on_shared_thread_view`):

```python
import praisonaiui as aiui

@aiui.on_shared_view
async def allow_shared(thread_id: str, viewer) -> bool:
    # Return True to allow read-only viewing; viewer is a User or None (anonymous)
    return viewer is not None
```

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/api/threads/{thread_id}/share` | `POST` | Bearer token | Generate a share token and return `{"url": "...", "token": "..."}` |
| `/api/threads/{thread_id}/unshare` | `POST` | Bearer token | Revoke share tokens created by the caller for `thread_id` |
| `/shared/{token}` | `GET` | Optional | View a shared thread (read-only HTML, or JSON when `Accept: application/json` is sent); gated by `@aiui.on_shared_view` |

Python helpers exported on `praisonaiui`: `create_share_token(thread_id, created_by)`, `get_thread_by_share_token(token)`, `revoke_share_token(thread_id, user_id)`, `list_share_tokens(user_id)`, and `get_share_url(token, base_url="")`.

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
