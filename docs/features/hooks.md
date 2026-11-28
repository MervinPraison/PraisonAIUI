# Pre/Post Operation Hooks

> HooksFeature (builtin.hooks) exposes pre- and post-operation hooks over REST and the CLI, merging hooks defined in praisonaiagents.hooks (SDK hooks) with hooks

`HooksFeature` (`builtin.hooks`) exposes pre- and post-operation hooks over REST and the CLI, merging hooks defined in `praisonaiagents.hooks` (SDK hooks) with hooks registered dynamically through the API.

## REST API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/hooks` | List all merged SDK and UI-registered hooks |
| `POST` | `/api/hooks` | Register a new hook (`name`, `event`, `type`: `"pre"` \| `"post"`, `enabled`) |
| `GET` | `/api/hooks/{hook_id}` | Fetch a UI-registered hook |
| `DELETE` | `/api/hooks/{hook_id}` | Delete a UI-registered hook |
| `POST` | `/api/hooks/{hook_id}/trigger` | Trigger a hook manually with optional `{"data": {...}}` payload |
| `GET` | `/api/hooks/log` | View recent hook executions (`?limit=50`) |

### Quick Example

```bash
# Register a pre-tool hook
curl -X POST http://127.0.0.1:8000/api/hooks \
  -H "Content-Type: application/json" \
  -d '{"name": "audit_tool_calls", "event": "tool_call", "type": "pre"}'

# Trigger it manually and inspect the execution log
curl -X POST http://127.0.0.1:8000/api/hooks/<hook_id>/trigger \
  -H "Content-Type: application/json" \
  -d '{"data": {"tool": "shell"}}'

curl http://127.0.0.1:8000/api/hooks/log?limit=20
```

## CLI Commands

```bash
aiui hooks list
aiui hooks trigger <hook_id>
aiui hooks log
```

## Disabling

```yaml
extensions:
  disabled:
    - builtin.hooks
```

## See Also

- [Approvals](https://ui.praison.ai/docs/features/approvals.md)
- [Handler Context](https://ui.praison.ai/docs/features/handler-context.md)
- [Features REST API](https://ui.praison.ai/docs/api/features-api.md#hooks)

## Related pages

- [Workflows, Hooks & OpenAI-Compatible API](https://ui.praison.ai/docs/features/workflows-and-openai-api.md)
- [AG-UI Protocol](https://ui.praison.ai/docs/features/agui.md)
- [Feature Protocols](https://ui.praison.ai/docs/features/protocols.md)
