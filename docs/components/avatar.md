---
title: Avatar
nav_title: Avatar
description: User or agent avatar with automatic initials fallback and responsive sizes.
---

# Avatar

`avatar()` renders a circular profile image with automatic initials fallback when no `src` image is provided or if the image fails to load.

<ComponentPreview title="Avatar Sizes & Fallbacks">
{
  "type": "columns",
  "children": [
    {"type": "avatar", "name": "Ada Lovelace", "size": "sm"},
    {"type": "avatar", "name": "Grace Hopper", "size": "md"},
    {"type": "avatar", "name": "Alan Turing", "size": "lg"},
    {"type": "avatar", "name": "Research Agent", "fallback": "AI", "size": "md"}
  ]
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.avatar(name="Ada Lovelace", size="md")
aiui.avatar(name="Research Agent", fallback="AI", size="lg")
```
</Tab>
<Tab title="YAML">
```yaml
- type: avatar
  name: "Ada Lovelace"
  size: "md"
- type: avatar
  name: "Research Agent"
  fallback: "AI"
  size: "lg"
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `src` | `str` | Optional image URL. |
| `name` | `str` | Accessible label and source for automatic initials. |
| `fallback` | `str` | Explicit fallback initials (e.g. `"AI"`). |
| `size` | `str` | `"sm"`, `"md"` (default), or `"lg"`. |
