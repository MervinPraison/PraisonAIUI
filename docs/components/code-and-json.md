# Code Block & JSON View

> Syntax-highlighted code snippets and structured JSON payloads for developer dashboards.

Display source snippets with `code_block()` and formatted API payloads or agent tool outputs with `json_view()`.

[
  {"type": "code_block", "language": "python", "code": "import praisonaiui as aiui\n\n@aiui.reply\nasync def reply(msg):\n    await aiui.say(f'Echo: {msg}')"},
  {"type": "json_view", "data": {"agent": "researcher", "model": "gpt-4o", "latency_ms": 118, "tools": ["web_search", "memory"]}}
]

## Python

```python
import praisonaiui as aiui

aiui.code_block("import praisonaiui as aiui\n", language="python")
aiui.json_view({"agent": "researcher", "model": "gpt-4o", "latency_ms": 118})
```

## YAML

```yaml
- type: code_block
  language: "python"
  code: |
    import praisonaiui as aiui
- type: json_view
  data:
    agent: "researcher"
    model: "gpt-4o"
```

## Props

| Component | Parameter | Description |
|---|---|---|
| `code_block` | `code`, `language` | Code string and syntax language identifier (`python`, `yaml`, `json`, `bash`, etc.). |
| `json_view` | `data` | Any JSON-serializable dict or list formatted with indentation. |

## Related pages

- [App & Dashboard Overview](https://ui.praison.ai/docs/app-ui/overview.md)
- [Tree View](https://ui.praison.ai/docs/components/tree-view.md)
- [Code Execution](https://ui.praison.ai/docs/features/code-execution.md)
