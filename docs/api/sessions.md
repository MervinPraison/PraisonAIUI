# Sessions API Reference

## Endpoints

### `GET /sessions`
List all sessions.

**Response:**
```json
{
  "sessions": [
    {
      "id": "abc-123",
      "created_at": "2026-03-04T07:00:00+00:00",
      "updated_at": "2026-03-04T07:05:00+00:00",
      "message_count": 4
    }
  ]
}
```

---

### `POST /sessions`
Create a new session.

**Response:**
```json
{
  "session_id": "abc-123-new"
}
```

---

### `GET /sessions/{session_id}`
Get full session data including messages.

**Response:**
```json
{
  "id": "abc-123",
  "created_at": "2026-03-04T07:00:00+00:00",
  "updated_at": "2026-03-04T07:05:00+00:00",
  "messages": [
    {"role": "user", "content": "Hello", "timestamp": "..."},
    {"role": "assistant", "content": "Hi there!", "timestamp": "..."}
  ]
}
```

---

### `GET /sessions/{session_id}/runs`
Get message history for a session.

**Response:**
```json
{
  "runs": [
    {"role": "user", "content": "Hello", "timestamp": "..."},
    {"role": "assistant", "content": "Hi there!", "timestamp": "..."}
  ]
}
```

---

### `DELETE /sessions/{session_id}`
Delete a session.

**Response:**
```json
{
  "status": "deleted"
}
```

---

### `POST /run`
Send a message and receive streaming response via SSE.

**Request:**
```json
{
  "message": "Hello, how are you?",
  "session_id": "abc-123",
  "agent": "assistant"
}
```

If `session_id` is omitted or `null`, a new session is created automatically.

**Response:** Server-Sent Events stream:
```
data: {"type": "session", "session_id": "abc-123"}
data: {"type": "token", "token": "Hello"}
data: {"type": "token", "token": " there!"}
data: {"type": "end"}
```

---

### `POST /cancel`
Cancel an active run.

**Request:**
```json
{
  "session_id": "abc-123"
}
```

---

### `GET /health`
Server health check.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-04T07:00:00"
}
```

---

### `GET /agents`
List registered agents.

**Response:**
```json
{
  "agents": [
    {"name": "assistant", "created_at": "..."}
  ]
}
```

## Error Responses

All endpoints return `404` when a session is not found:
```json
{
  "error": "Session not found"
}
```
