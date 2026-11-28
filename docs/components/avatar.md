# Avatar

> User or agent avatar with automatic initials fallback and responsive sizes.

`avatar()` renders a circular profile image with automatic initials fallback when no `src` image is provided or if the image fails to load.

{
  "type": "columns",
  "children": [
    {"type": "avatar", "name": "Ada Lovelace", "size": "sm"},
    {"type": "avatar", "name": "Grace Hopper", "size": "md"},
    {"type": "avatar", "name": "Alan Turing", "size": "lg"},
    {"type": "avatar", "name": "Research Agent", "fallback": "AI", "size": "md"}
  ]
}

## Python

```python
import praisonaiui as aiui

aiui.avatar(name="Ada Lovelace", size="md")
aiui.avatar(name="Research Agent", fallback="AI", size="lg")
```

## YAML

```yaml
- type: avatar
  name: "Ada Lovelace"
  size: "md"
- type: avatar
  name: "Research Agent"
  fallback: "AI"
  size: "lg"
```

## Props

| Parameter | Type | Description |
|---|---|---|
| `src` | `str` | Optional image URL. |
| `name` | `str` | Accessible label and source for automatic initials. |
| `fallback` | `str` | Explicit fallback initials (e.g. `"AI"`). |
| `size` | `str` | `"sm"`, `"md"` (default), or `"lg"`. |

## Related pages

- [Gallery](https://ui.praison.ai/docs/components/gallery.md)
- [Doc Viewer](https://ui.praison.ai/docs/components/doc-viewer.md)
- [Model Fallback](https://ui.praison.ai/docs/features/model-fallback.md)
