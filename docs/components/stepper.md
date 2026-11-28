# Stepper

> Show multi-step workflow, onboarding, or pipeline progress horizontally or vertically.

`stepper()` renders numbered workflow stages with automatic completed, active, and upcoming states—or explicit per-step status (`completed`, `active`, `pending`, `error`).

{
  "type": "stepper",
  "title": "Agent Deployment Pipeline",
  "active": 2,
  "orientation": "horizontal",
  "steps": [
    {"label": "Connect LLM", "description": "Provider verified"},
    {"label": "Index Knowledge", "description": "420 docs embedded"},
    {"label": "Run Evals", "description": "Checking accuracy"},
    {"label": "Publish", "description": "Production deploy"}
  ]
}

## Python

```python
import praisonaiui as aiui

aiui.stepper(
    [
        {"label": "Connect LLM", "description": "Provider verified"},
        {"label": "Index Knowledge", "description": "420 docs embedded"},
        {"label": "Run Evals", "description": "Checking accuracy"},
        {"label": "Publish", "description": "Production deploy"},
    ],
    active=2,
    orientation="horizontal",
    title="Agent Deployment Pipeline",
)
```

## YAML

```yaml
- type: stepper
  title: "Agent Deployment Pipeline"
  active: 2
  orientation: "horizontal"
  steps:
    - label: "Connect LLM"
      description: "Provider verified"
    - label: "Index Knowledge"
      description: "420 docs embedded"
    - label: "Run Evals"
      description: "Checking accuracy"
    - label: "Publish"
      description: "Production deploy"
```

## Props

| Parameter | Type | Description |
|---|---|---|
| `steps` | `list[dict]` | Ordered steps (`label`, optional `description` and `status`: `completed`, `active`, `pending`, `error`). |
| `active` | `int` | Zero-based active step index used when per-step `status` is omitted. |
| `orientation` | `str` | `"horizontal"` (default, wraps on phone) or `"vertical"`. |
| `title` | `str` | Optional header above the stepper. |

## Related pages

- [Interactive Response Examples](https://ui.praison.ai/docs/a2ui/response-examples.md)
- [Workflows, Hooks & OpenAI-Compatible API](https://ui.praison.ai/docs/features/workflows-and-openai-api.md)
- [Badge & Status](https://ui.praison.ai/docs/components/badge.md)
