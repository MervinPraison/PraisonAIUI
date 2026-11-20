# Model Fallback

The model fallback feature (`praisonaiui.features.model_fallback`) lists the
available models and stores an ordered fallback chain that the UI can show and
edit.

!!! note "The chain is stored, not applied"
    Nothing in PraisonAIUI reads the chain when it sends a request: the
    provider still calls the agent's own model, and a failed call is not retried
    on the next model. The chain is also kept in memory only, so a restart
    clears it. Use it as a setting your own provider or `@aiui.reply` callback
    reads (see below).

## Quick Start

```bash
# List available models and the current chain
curl http://localhost:8000/api/models

# Set the chain
curl -X PUT http://localhost:8000/api/models/fallback \
  -H "Content-Type: application/json" \
  -d '{"models": ["gpt-4o", "gpt-4o-mini", "claude-3-5-sonnet"]}'
```

## Model Discovery

The model list comes from `litellm.model_list` when LiteLLM is installed and
has models configured. Otherwise it is a short static list: `gpt-4o`,
`gpt-4o-mini`, `claude-3-5-sonnet` and `gemini-2.0-flash`.

## Reading the Chain

Use the server's shared manager, not a new `ModelFallbackManager()`, so you see
what the API set:

```python
from praisonaiui.features.model_fallback import get_fallback_manager

mgr = get_fallback_manager()

mgr.get_models()
# [{"id": "gpt-4o", "provider": "openai"}, ...]

mgr.set_fallback_chain(["gpt-4o", "gpt-4o-mini"])
mgr.get_fallback_chain()
# ["gpt-4o", "gpt-4o-mini"]
```

## REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/models` | GET | Available models and the current fallback chain |
| `/api/models/fallback` | PUT | Set the chain (`{"models": [...]}`; 400 if not a list) |

### List Models

```json
{
  "models": [
    {"id": "gpt-4o", "provider": "openai"},
    {"id": "gpt-4o-mini", "provider": "openai"},
    {"id": "claude-3-5-sonnet", "provider": "anthropic"},
    {"id": "gemini-2.0-flash", "provider": "google"}
  ],
  "fallback_chain": ["gpt-4o", "gpt-4o-mini"]
}
```

## Related

- [Providers](../concepts/providers.md): LLM provider configuration
