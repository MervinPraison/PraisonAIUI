# Gallery

> Responsive media and artifact gallery grid with titles, captions, tags, and links.

`gallery()` displays a responsive tile grid for generated images, screenshots, videos, or clickable artifacts.

{
  "type": "gallery",
  "items": [
    {"title": "Chat + Canvas", "caption": "Default split workspace layout", "tag": "Layout"},
    {"title": "Mission Control", "caption": "Multi-agent run monitoring", "tag": "Layout"},
    {"title": "A2UI Surfaces", "caption": "Agent-driven interactive cards", "tag": "Protocol"}
  ]
}

## Python

```python
import praisonaiui as aiui

aiui.gallery([
    {"title": "Chat + Canvas", "caption": "Default split workspace layout", "tag": "Layout"},
    {"title": "Mission Control", "caption": "Multi-agent run monitoring", "tag": "Layout"},
    {"title": "A2UI Surfaces", "caption": "Agent-driven interactive cards", "tag": "Protocol"},
])
```

## YAML

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

## Props

| Parameter | Type | Description |
|---|---|---|
| `items` | `list[dict]` | Gallery tiles supporting `title`, `caption`, `subtitle`, `description`, `tag`, `src`/`image`, `video`, `href`, and `page`. |

## Related pages

- [Card & Card Grid](https://ui.praison.ai/docs/components/card.md)
- [Columns, Container & Layout](https://ui.praison.ai/docs/components/columns.md)
- [Media, Markdown & Content Components](https://ui.praison.ai/docs/components/media-and-content.md)
