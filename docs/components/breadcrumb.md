# Breadcrumb

> Hierarchical navigation trail showing the user's location across nested pages.

`breadcrumb()` displays a semantic `<nav aria-label="Breadcrumb">` trail where preceding items link cleanly and the final item marks the current page.

{
  "type": "breadcrumb",
  "items": [
    {"label": "Workspace", "href": "#"},
    {"label": "Agents", "href": "#"},
    {"label": "Researcher v2"}
  ]
}

## Python

```python
import praisonaiui as aiui

aiui.breadcrumb([
    {"label": "Workspace", "href": "/"},
    {"label": "Agents", "page": "agents"},
    {"label": "Researcher v2"},
])
```

## YAML

```yaml
- type: breadcrumb
  items:
    - label: "Workspace"
      href: "/"
    - label: "Agents"
      page: "agents"
    - label: "Researcher v2"
```

## Props

| Parameter | Type | Description |
|---|---|---|
| `items` | `list[dict]` | Ordered crumb dicts with `label` and optional `href` or `page` (SPA route ID). |

## Related pages

- [Tree View](https://ui.praison.ai/docs/components/tree-view.md)
- [Layout & Navigation Components](https://ui.praison.ai/docs/components/layout.md)
- [Tabs](https://ui.praison.ai/docs/components/tabs.md)
