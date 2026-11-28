---
title: Tree View
nav_title: Tree View
description: Collapsible hierarchical tree for file browsers, RAG sources, and nested agent graphs.
---

# Tree View

`tree_view()` renders an interactive collapsible hierarchy—ideal for file explorers, RAG document sources, or nested subagent trees.

<ComponentPreview title="Collapsible Tree View">
{
  "type": "tree_view",
  "title": "Knowledge Sources",
  "default_expanded": true,
  "nodes": [
    {
      "label": "docs/",
      "children": [
        {"label": "quickstart.md", "meta": "4.2 KB"},
        {"label": "components/overview.md", "meta": "3.4 KB"}
      ]
    },
    {
      "label": "src/agents/",
      "children": [
        {"label": "researcher.py", "meta": "Active"},
        {"label": "reviewer.py", "meta": "Idle"}
      ]
    },
    {"label": "aiui.yaml", "meta": "Config"}
  ]
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.tree_view(
    [
        {"label": "docs/", "children": [{"label": "quickstart.md", "meta": "4.2 KB"}]},
        {"label": "aiui.yaml", "meta": "Config"},
    ],
    title="Knowledge Sources",
    default_expanded=True,
)
```
</Tab>
<Tab title="YAML">
```yaml
- type: tree_view
  title: "Knowledge Sources"
  default_expanded: true
  nodes:
    - label: "docs/"
      children:
        - label: "quickstart.md"
          meta: "4.2 KB"
    - label: "aiui.yaml"
      meta: "Config"
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `nodes` | `list[dict]` | Recursive node dicts (`label`, optional `meta`, `badge`, and `children`). |
| `title` | `str` | Optional heading above the tree. |
| `default_expanded` | `bool` | Expand parent folders on initial render (default `False`). |
