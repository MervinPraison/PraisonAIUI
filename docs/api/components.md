# Component API Reference

Python functions for building dashboard UIs. Each function returns a dict that the frontend renders as a real UI element.

```python
import praisonaiui as aiui
```

## `aiui.layout(children)`

Wrap components in a renderable container.

```python
aiui.layout([
    aiui.card("Users", value=42),
    aiui.table(headers=["A"], rows=[["x"]]),
])
# Returns: {"_components": [...]}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `children` | `Sequence[dict]` | ✅ | List of component dicts |

**Returns:** `dict` with `_components` key — triggers structured rendering in the frontend.

---

## `aiui.card(title, *, value, footer)`

A metric/stat card.

```python
aiui.card("Revenue", value="$1,500", footer="+8% this month")
# Returns: {"type": "card", "title": "Revenue", "value": "$1,500", "footer": "+8% this month"}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | `str` | ✅ | Card header label |
| `value` | `Any` | ❌ | Main display value |
| `footer` | `str` | ❌ | Small text below the value |

---

## `aiui.columns(children)`

Arrange components in a responsive grid row.

```python
aiui.columns([
    aiui.card("A", value=1),
    aiui.card("B", value=2),
    aiui.card("C", value=3),
])
# Returns: {"type": "columns", "children": [...]}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `children` | `Sequence[dict]` | ✅ | Component dicts to lay out side-by-side |

---

## `aiui.table(*, headers, rows)`

A data table.

```python
aiui.table(
    headers=["Name", "Role"],
    rows=[["Alice", "Engineer"], ["Bob", "Designer"]],
)
# Returns: {"type": "table", "headers": [...], "rows": [...]}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `headers` | `Sequence[str]` | ✅ | Column header labels |
| `rows` | `Sequence[Sequence[Any]]` | ✅ | Row data arrays |

---

## `aiui.text(content)`

A text block.

```python
aiui.text("Last updated 30 seconds ago.")
# Returns: {"type": "text", "content": "Last updated 30 seconds ago."}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | `str` | ✅ | Text content |

---

## `aiui.chart(title, *, data, chart_type)`

A chart placeholder.

```python
aiui.chart("Revenue", data=[{"month": "Jan", "value": 100}], chart_type="line")
# Returns: {"type": "chart", "title": "Revenue", "data": [...], "chart_type": "line"}
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | `str` | ✅ | — | Chart title |
| `data` | `Sequence[dict]` | ❌ | `[]` | Data points |
| `chart_type` | `str` | ❌ | `"bar"` | Chart type (`bar`, `line`, `pie`) |

---

## Composition

Components are designed to compose. Use `columns()` for horizontal layout within a `layout()`:

```python
@aiui.page("overview", title="Overview", icon="📊")
async def overview():
    return aiui.layout([
        # Row of KPI cards
        aiui.columns([
            aiui.card("Users", value=142),
            aiui.card("Revenue", value="$1.5k"),
            aiui.card("Uptime", value="99.9%"),
        ]),
        # Data table
        aiui.table(
            headers=["Agent", "Tasks", "Status"],
            rows=[
                ["Researcher", 15, "Active"],
                ["Writer", 8, "Idle"],
            ],
        ),
        # Footer text
        aiui.text("Data refreshes every 30 seconds."),
    ])
```

## Custom Component Types

The `dashboard.js` renderer supports any dict with a `type` key. Unknown types render as formatted JSON, making it safe to experiment:

```python
# Custom component — renders as JSON until frontend support is added
{"type": "timeline", "events": [{"time": "10:00", "label": "Deploy"}]}
```
