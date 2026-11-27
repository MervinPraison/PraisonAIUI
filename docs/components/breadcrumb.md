---
title: Breadcrumb
nav_title: Breadcrumb
description: Hierarchical navigation trail showing the user's location across nested pages.
---

# Breadcrumb

`breadcrumb()` displays a semantic `<nav aria-label="Breadcrumb">` trail where preceding items link cleanly and the final item marks the current page.

<ComponentPreview title="Breadcrumb">
{
  "type": "breadcrumb",
  "items": [
    {"label": "Workspace", "href": "#"},
    {"label": "Agents", "href": "#"},
    {"label": "Researcher v2"}
  ]
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.breadcrumb([
    {"label": "Workspace", "href": "/"},
    {"label": "Agents", "page": "agents"},
    {"label": "Researcher v2"},
])
```
</Tab>
<Tab title="YAML">
```yaml
- type: breadcrumb
  items:
    - label: "Workspace"
      href: "/"
    - label: "Agents"
      page: "agents"
    - label: "Researcher v2"
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `items` | `list[dict]` | Ordered crumb dicts with `label` and optional `href` or `page` (SPA route ID). |
