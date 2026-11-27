---
title: Code Block & JSON View
nav_title: Code & JSON
description: Syntax-highlighted code snippets and structured JSON payloads for developer dashboards.
---

# Code Block & JSON View

Display source snippets with `code_block()` and formatted API payloads or agent tool outputs with `json_view()`.

<ComponentPreview title="Code Block & JSON View">
[
  {"type": "code_block", "language": "python", "code": "import praisonaiui as aiui\n\n@aiui.reply\nasync def reply(msg):\n    await aiui.say(f'Echo: {msg}')"},
  {"type": "json_view", "data": {"agent": "researcher", "model": "gpt-4o", "latency_ms": 118, "tools": ["web_search", "memory"]}}
]
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.code_block("import praisonaiui as aiui\n", language="python")
aiui.json_view({"agent": "researcher", "model": "gpt-4o", "latency_ms": 118})
```
</Tab>
<Tab title="YAML">
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
</Tab>
</Tabs>

## Props

| Component | Parameter | Description |
|---|---|---|
| `code_block` | `code`, `language` | Code string and syntax language identifier (`python`, `yaml`, `json`, `bash`, etc.). |
| `json_view` | `data` | Any JSON-serializable dict or list formatted with indentation. |
