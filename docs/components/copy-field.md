# Copy Field

> One-click clipboard copy box for CLI commands, webhook URLs, and masked API secrets.

`copy_field()` displays a monospace command, endpoint, or API token with a one-click copy button and optional secret masking toggle (`secret=True`).

[
  {"type": "copy_field", "label": "Quick Install", "value": "pip install aiui && aiui run app.py", "secret": false},
  {"type": "copy_field", "label": "Gateway API Token", "value": "aiui_live_9f8a7c6b5d4e3f2a1b", "secret": true}
]

## Python

```python
import praisonaiui as aiui

aiui.copy_field("pip install aiui && aiui run app.py", label="Quick Install")
aiui.copy_field("aiui_live_9f8a7c6b5d4e3f2a1b", label="Gateway API Token", secret=True)
```

## YAML

```yaml
- type: copy_field
  label: "Quick Install"
  value: "pip install aiui && aiui run app.py"
- type: copy_field
  label: "Gateway API Token"
  value: "aiui_live_9f8a7c6b5d4e3f2a1b"
  secret: true
```

## Props

| Parameter | Type | Description |
|---|---|---|
| `value` | `str` | Exact text copied to the clipboard on click. |
| `label` | `str` | Optional label shown above the copy field. |
| `secret` | `bool` | Mask the value by default with an accessible show/hide toggle (default `False`). |

## Related pages

- [Interactive Response Examples](https://ui.praison.ai/docs/a2ui/response-examples.md)
- [MCP servers](https://ui.praison.ai/docs/features/mcp.md)
- [Text, Caption & Markdown](https://ui.praison.ai/docs/components/text-and-markdown.md)
