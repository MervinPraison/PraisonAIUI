---
title: Multiselect & Tags Input
nav_title: Multiselect & Tags
description: Multi-choice chip selector and free-text tag input for tools, labels, and filters.
---

# Multiselect & Tags Input

Use `multiselect_input()` to pick multiple values from a searchable list, and `tags_input()` to let users type free-form tags (press Enter or comma to add a chip).

<ComponentPreview title="Multiselect & Free-Text Tags">
[
  {"type": "multiselect_input", "label": "Enabled Tools", "options": ["web_search", "code_exec", "memory", "mcp", "browser"], "value": ["web_search", "memory"], "name": "tools"},
  {"type": "tags_input", "label": "Labels (type + Enter)", "value": ["production", "rag"], "placeholder": "Add a tag...", "name": "tags"}
]
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.multiselect_input(
    "Enabled Tools",
    options=["web_search", "code_exec", "memory", "mcp"],
    value=["web_search", "memory"],
    name="tools",
)
aiui.tags_input("Labels", value=["production", "rag"], placeholder="Add a tag...", name="tags")
```
</Tab>
<Tab title="YAML">
```yaml
- type: multiselect_input
  label: "Enabled Tools"
  options: ["web_search", "code_exec", "memory", "mcp"]
  value: ["web_search", "memory"]
  name: "tools"
- type: tags_input
  label: "Labels"
  value: ["production", "rag"]
  name: "tags"
```
</Tab>
</Tabs>

## Props

| Component | Parameter | Description |
|---|---|---|
| `multiselect_input` | `label`, `options`, `value`, `name`, `options_url`, `placeholder` | Searchable multi-select displaying removable chips; supports remote `options_url`. |
| `tags_input` | `label`, `value`, `name`, `placeholder`, `auto_submit` | Free-text chip editor supporting Enter/comma insertion and Backspace removal. |
