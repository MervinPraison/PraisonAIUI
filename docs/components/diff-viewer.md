---
title: Diff Viewer
nav_title: Diff Viewer
description: Unified line-by-line diff viewer for comparing prompts, YAML configs, or generated code.
---

# Diff Viewer

`diff_viewer()` computes and renders an accessible unified diff highlighting additions and removals—perfect for reviewing agent edits, prompt revisions, or config changes.

<ComponentPreview title="Unified Diff Viewer">
{
  "type": "diff_viewer",
  "title": "agent.yaml",
  "before_label": "v1",
  "after_label": "v2",
  "before": "model: gpt-4o-mini\ntemperature: 0.7\nmax_tokens: 1024\ntools:\n  - web_search",
  "after": "model: gpt-4o\ntemperature: 0.2\nmax_tokens: 4096\ntools:\n  - web_search\n  - code_exec"
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.diff_viewer(
    before="model: gpt-4o-mini\ntemperature: 0.7\n",
    after="model: gpt-4o\ntemperature: 0.2\n",
    title="agent.yaml",
    before_label="v1",
    after_label="v2",
)
```
</Tab>
<Tab title="YAML">
```yaml
- type: diff_viewer
  title: "agent.yaml"
  before_label: "v1"
  after_label: "v2"
  before: |
    model: gpt-4o-mini
    temperature: 0.7
  after: |
    model: gpt-4o
    temperature: 0.2
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `before`, `after` | `str` | Original and modified text strings (or `before_file` / `after_file` in YAML). |
| `title` | `str` | Optional filename or heading above the diff header. |
| `before_label`, `after_label` | `str` | Labels for the removed and added revisions (defaults: `"Before"`, `"After"`). |
