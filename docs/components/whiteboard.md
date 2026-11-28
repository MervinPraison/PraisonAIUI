# Interactive Whiteboard

> Draggable whiteboard canvas with stickies, shapes, groups, live-tracking arrows, zoom, fullscreen modal, and SVG/JSON export.

`whiteboard()` renders an interactive spatial canvas with draggable sticky notes, shapes, labeled connectors, inline `+ Sticky` creation, zoom controls, fullscreen mode (`Escape` to close), and one-click SVG/JSON export. All item colors are validated against a strict hex/palette allowlist to prevent CSS injection.

Drag any sticky note below, click **+ Sticky**, zoom in/out, or click **Expand** for fullscreen view.

{
  "type": "whiteboard",
  "id": "launch-flow",
  "title": "Agent Release Architecture",
  "items": [
    {"id": "user", "type": "sticky", "text": "User Prompt\n(Chat or YAML)", "x": 28, "y": 40, "w": 156, "h": 80, "color": "yellow"},
    {"id": "planner", "type": "sticky", "text": "Planner Agent\nGenerates Sheet + Plan", "x": 236, "y": 40, "w": 176, "h": 80, "color": "blue"},
    {"id": "hitl", "type": "shape", "shape": "ellipse", "text": "Human Approval", "x": 464, "y": 44, "w": 144, "h": 72, "color": "amber"},
    {"id": "deploy", "type": "sticky", "text": "Live Dashboard\n+ Notification", "x": 236, "y": 172, "w": 176, "h": 80, "color": "green"},
    {"type": "arrow", "from": "user", "to": "planner", "label": "stream"},
    {"type": "arrow", "from": "planner", "to": "hitl", "label": "review"},
    {"type": "arrow", "from": "hitl", "to": "deploy", "label": "approved"}
  ]
}

## Python (@aiui.page)

```python
import praisonaiui as aiui

aiui.whiteboard(
    title="Agent Release Architecture",
    id="launch-flow",
    items=[
        {"id": "user", "type": "sticky", "text": "User Prompt", "x": 28, "y": 40, "color": "yellow"},
        {"id": "planner", "type": "sticky", "text": "Planner Agent", "x": 236, "y": 40, "color": "blue"},
        {"id": "deploy", "type": "sticky", "text": "Live Dashboard", "x": 444, "y": 40, "color": "green"},
        {"type": "arrow", "from": "user", "to": "planner", "label": "stream"},
        {"type": "arrow", "from": "planner", "to": "deploy", "label": "publish"},
    ],
)
```

## YAML (app.yaml)

```yaml
- type: whiteboard
  id: launch-flow
  title: Agent Release Architecture
  items:
    - { id: user, type: sticky, text: "User Prompt", x: 28, y: 40, color: yellow }
    - { id: planner, type: sticky, text: "Planner Agent", x: 236, y: 40, color: blue }
    - { type: arrow, from: user, to: planner, label: stream }
```

## Chat Fence (Agent Reply)

````markdown
```whiteboard
{"id":"launch-flow","title":"Launch Plan","items":[{"id":"a","type":"sticky","text":"Design","x":24,"y":24,"color":"blue"},{"id":"b","type":"sticky","text":"Ship","x":240,"y":24,"color":"green"},{"type":"arrow","from":"a","to":"b","label":"go"}]}
```
````

## Item Schema

| Type | Fields | Notes |
|---|---|---|
| `sticky` / `shape` | `id`, `text`, `x`, `y`, `w`, `h`, `color`, `shape` (`rect` \| `ellipse`) | `color` accepts 3/6-digit `#hex` or named presets (`yellow`, `blue`, `green`, `pink`, `purple`, `amber`, `cyan`, `slate`). Invalid CSS values fall back to the safe palette. |
| `group` / `text` | `id`, `text`, `x`, `y`, `w`, `h` | Dashed group containers and canvas titles. |
| `arrow` | `from`, `to`, `label?` | Connects two node IDs and updates live when nodes are dragged. |

## Related pages

- [Data Display & Charts](https://ui.praison.ai/docs/components/data-display.md)
- [Component API Reference](https://ui.praison.ai/docs/api/components.md)
- [Dialog](https://ui.praison.ai/docs/components/dialog.md)
