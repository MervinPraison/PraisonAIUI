# Workflows, Hooks & OpenAI-Compatible API

> Orchestrate multi-step agent workflows, trigger server lifecycle hooks and call your agents over an OpenAI-compatible HTTP endpoint.

Beyond interactive chat, PraisonAIUI exposes automation and integration APIs so external tools, scripts and multi-agent pipelines can drive your agents directly.

## Workflows (`builtin.workflows`)

Define, trigger and inspect multi-step agent workflows over REST:

- `GET /api/workflows` / `POST /api/workflows` — List or create workflow definitions
- `POST /api/workflows/{workflow_id}/run` — Execute a workflow
- `GET /api/workflows/{workflow_id}/status` — Inspect workflow state
- `GET /api/workflows/runs` / `GET /api/workflows/runs/{run_id}` — Review run history and outputs

## Lifecycle hooks (`builtin.hooks`)

Register server-side hooks to react to platform events and inspect execution history:

- `GET /api/hooks` / `POST /api/hooks` — List or register hooks
- `POST /api/hooks/{hook_id}/trigger` — Trigger a hook manually
- `GET /api/hooks/log` — Inspect recent hook invocations

## OpenAI-compatible API (`builtin.api`)

Call your registered PraisonAIUI agents from any OpenAI-compatible client, SDK, or editor using the built-in `api` plugin (see the **API** page in the dashboard for ready-to-copy curl/SDK snippets and authentication headers). All requests honor the server's active auth middleware (R8).

```bash
curl http://127.0.0.1:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AIUI_API_TOKEN" \
  -d '{"model": "default", "messages": [{"role": "user", "content": "Hello!"}]}'
```

## Related pages

- [Pre/Post Operation Hooks](https://ui.praison.ai/docs/features/hooks.md)
- [API Testing Guide](https://ui.praison.ai/docs/api/testing.md)
- [Feature Protocols](https://ui.praison.ai/docs/features/protocols.md)
