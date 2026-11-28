---
title: Gallery
nav_title: Gallery
description: Responsive media and artifact gallery grid with titles, captions, tags, and links.
---

# Gallery

`gallery()` displays a responsive tile grid for generated images, screenshots, videos, or clickable artifacts.

<ComponentPreview title="Artifact Gallery">
{
  "type": "gallery",
  "items": [
    {"title": "Chat + Canvas", "caption": "Default split workspace layout", "tag": "Layout"},
    {"title": "Mission Control", "caption": "Multi-agent run monitoring", "tag": "Layout"},
    {"title": "A2UI Surfaces", "caption": "Agent-driven interactive cards", "tag": "Protocol"}
  ]
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.gallery([
    {"title": "Chat + Canvas", "caption": "Default split workspace layout", "tag": "Layout"},
    {"title": "Mission Control", "caption": "Multi-agent run monitoring", "tag": "Layout"},
    {"title": "A2UI Surfaces", "caption": "Agent-driven interactive cards", "tag": "Protocol"},
])
```
</Tab>
<Tab title="YAML">
```yaml
- type: gallery
  items:
    - title: "Chat + Canvas"
      caption: "Default split workspace layout"
      tag: "Layout"
    - title: "A2UI Surfaces"
      caption: "Agent-driven interactive cards"
      tag: "Protocol"
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `items` | `list[dict]` | Gallery tiles supporting `title`, `caption`, `subtitle`, `description`, `tag`, `src`/`image`, `video`, `href`, and `page`. |
