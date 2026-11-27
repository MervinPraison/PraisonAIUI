---
title: Links & Page Navigation
nav_title: Links & Page Link
description: Inline links, button-styled links, and SPA page links with query parameters.
---

# Links & Page Navigation

Use `link()` for inline hyperlinks, `link_button()` for prominent call-to-action links, and `page_link()` to jump to another `@aiui.page` route without a full browser reload.

<ComponentPreview title="Link, Link Button & Page Link">
[
  {"type": "link", "text": "Read the Quickstart guide", "href": "/docs/getting-started/quickstart", "external": false},
  {"type": "columns", "children": [
    {"type": "link", "text": "Open Quickstart", "href": "/docs/getting-started/quickstart", "variant": "primary"},
    {"type": "link", "text": "Inspect Agents", "href": "/agents", "page": "agents", "variant": "outline"}
  ]}
]
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.link("Read the Quickstart guide", href="/docs/getting-started/quickstart")
aiui.link_button("Open Quickstart", "/docs/getting-started/quickstart", variant="primary")
aiui.page_link("agents", "Inspect Agents", variant="outline", params={"env": "prod"})
```
</Tab>
<Tab title="YAML">
```yaml
- type: link
  text: "Read the Quickstart guide"
  href: "/docs/getting-started/quickstart"
- type: link
  text: "Inspect Agents"
  page: "agents"
  variant: "outline"
```
</Tab>
</Tabs>

## Props

| Component | Parameter | Description |
|---|---|---|
| `link` | `text`, `href`, `external` | Standard link (`external=True` opens in a new tab with `rel="noopener noreferrer"`). |
| `link_button` | `label`, `href`, `variant`, `external` | Button-styled link (`primary`, `secondary`, `outline`, `ghost`). |
| `page_link` | `page_id`, `label`, `variant`, `params` | Client-side SPA navigation to another registered page with optional URL query params. |
