---
title: The server's OpenAPI document
description: The running server describes its own HTTP API at /api/openapi.json, built from its live route table.
---

# The server's OpenAPI document

Every aiui server publishes an OpenAPI 3.1 document of its own HTTP API. Nothing to
configure: it is on by default.

```bash
curl http://localhost:8000/api/openapi.json           # no auth configured
curl -H "Authorization: Bearer $AIUI_TOKEN" https://my-app.example.com/api/openapi.json
```

`GET /api/openapi.json` is built from the route table the server is running, when it is
asked. It lists every API route it answers (`/api/*`, `/v1/*` and the unprefixed data
routes such as `/sessions` and `/run`): the core, each enabled built-in, and the routes of
your plugins and `register_feature()` features. It cannot go stale, and a built-in you
switch off (`extensions: {disabled: [builtin.training]}`) leaves it.

| Field | Comes from |
|---|---|
| `tags` | The built-in that owns the route (`sessions`, `api`, `config`…), a plugin's or feature's name, else `core` |
| `summary`, `description` | The handler's docstring: first line, then the rest (plain text; a leading `POST /path —` is dropped) |
| `parameters` | Path parameters and their types (`{id:int}` is an integer) |
| `security` | Bearer token; `[]` on the public routes (`/api/health`, sign-in) |
| `servers` | `/`: the server that served the document |
| `x-websockets` | The WebSocket routes (`/api/chat/ws`, `/api/logs/stream`) |

The route needs the same credentials as every other `/api` route in each auth mode. A
plugin the caller may not use (an entry-point plugin that is off by default on a remote or
sign-in server) is left out. Switch the document off with
`extensions: {disabled: [builtin.api-reference]}`.

Use it anywhere an OpenAPI file goes: client generators, API tools, or the API reference
of an `aiui` docs site (`api: {openapi: http://localhost:8000/api/openapi.json}`, see
[OpenAPI](openapi.md)).

## Request bodies for your feature

A feature adds request bodies, responses or anything else to its operations with an
optional `openapi()` method, keyed by `"METHOD /path"`:

```python
from praisonaiui.features import BaseFeatureProtocol

class NotesFeature(BaseFeatureProtocol):
    ...
    def openapi(self):
        return {
            "POST /api/notes": {
                "requestBody": {"content": {"application/json": {
                    "schema": {"type": "object", "properties": {"text": {"type": "string"}}},
                    "example": {"text": "Buy milk"},
                }}},
            },
        }
```

The OpenAI-compatible routes (`/v1/chat/completions`, `/v1/responses`, `/v1/embeddings`…)
carry their request bodies this way.
