# Component API Reference

Python functions for building dashboard UIs. Each function returns a dict that the frontend renders as a real UI element — **36 components** organized into tiers.

```python
import praisonaiui as aiui
```

---

## Core Components

### `aiui.layout(children)`

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

### `aiui.card(title, *, value, footer)`

A metric/stat card.

```python
aiui.card("Revenue", value="$1,500", footer="+8% this month")
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | `str` | ✅ | Card header label |
| `value` | `Any` | ❌ | Main display value |
| `footer` | `str` | ❌ | Small text below the value |

### `aiui.columns(children)`

Arrange components in a responsive grid row.

```python
aiui.columns([
    aiui.card("A", value=1),
    aiui.card("B", value=2),
    aiui.card("C", value=3),
])
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `children` | `Sequence[dict]` | ✅ | Component dicts to lay out side-by-side |

### `aiui.table(*, headers, rows)`

A data table.

```python
aiui.table(
    headers=["Name", "Role"],
    rows=[["Alice", "Engineer"], ["Bob", "Designer"]],
)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `headers` | `Sequence[str]` | ✅ | Column header labels |
| `rows` | `Sequence[Sequence[Any]]` | ✅ | Row data arrays |

### `aiui.text(content)`

A text block.

```python
aiui.text("Last updated 30 seconds ago.")
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | `str` | ✅ | Text content |

### `aiui.chart(title, *, data, chart_type)`

A chart.

```python
aiui.chart("Revenue", data=[{"month": "Jan", "value": 100}], chart_type="line")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | `str` | ✅ | — | Chart title |
| `data` | `Sequence[dict]` | ❌ | `[]` | Data points |
| `chart_type` | `str` | ❌ | `"bar"` | `bar`, `line`, or `pie` |

---

## Essential Components

### `aiui.metric(label, *, value, delta, delta_color)`

A metric card with optional delta indicator.

```python
aiui.metric("Requests", value="12.3k", delta="+15%")
aiui.metric("Errors", value=23, delta="+3", delta_color="inverse")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Metric label |
| `value` | `Any` | ✅ | — | Main metric value |
| `delta` | `str` | ❌ | `None` | Change indicator (e.g. "+5%") |
| `delta_color` | `str` | ❌ | `"normal"` | `"normal"`, `"inverse"`, or `"off"` |

### `aiui.progress_bar(label, *, value, max_value)`

A progress bar.

```python
aiui.progress_bar("Upload", value=73, max_value=100)
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Label above the bar |
| `value` | `int\|float` | ✅ | — | Current value |
| `max_value` | `int\|float` | ❌ | `100` | Maximum value |

### `aiui.alert(message, *, variant, title)`

An alert/notification box.

```python
aiui.alert("Deploy successful!", variant="success", title="Done")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `message` | `str` | ✅ | — | Alert body text |
| `variant` | `str` | ❌ | `"info"` | `"info"`, `"success"`, `"warning"`, `"error"` |
| `title` | `str` | ❌ | `None` | Optional bold title |

### `aiui.badge(text, *, variant)`

An inline badge/tag.

```python
aiui.badge("New")
aiui.badge("Deprecated", variant="destructive")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | `str` | ✅ | — | Badge label |
| `variant` | `str` | ❌ | `"default"` | `"default"`, `"secondary"`, `"destructive"`, `"outline"` |

### `aiui.separator()`

A horizontal separator line. No parameters.

### `aiui.tabs(items)`

A tabbed container.

```python
aiui.tabs([
    {"label": "Overview", "children": [aiui.text("Tab 1 content")]},
    {"label": "Details",  "children": [aiui.table(headers=["K","V"], rows=[["a","b"]])]},
])
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `items` | `Sequence[dict]` | ✅ | List of `{"label": str, "children": [comp_dicts]}` |

### `aiui.accordion(items)`

A collapsible accordion.

```python
aiui.accordion([
    {"title": "FAQ 1", "content": "Answer 1"},
    {"title": "FAQ 2", "content": "Answer 2"},
])
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `items` | `Sequence[dict]` | ✅ | List of `{"title": str, "content": str_or_comp}` |

### `aiui.image_display(src, *, alt, caption, width)`

An image with optional caption.

```python
aiui.image_display("https://example.com/logo.png", alt="Logo", caption="Our logo", width="300px")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `src` | `str` | ✅ | — | Image URL or path |
| `alt` | `str` | ❌ | `""` | Alt text |
| `caption` | `str` | ❌ | `None` | Caption below image |
| `width` | `str` | ❌ | `None` | CSS width (e.g. `"300px"`, `"50%"`) |

### `aiui.code_block(code, *, language)`

A code block with syntax highlighting.

```python
aiui.code_block("def hello():\n    print('Hi!')", language="python")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `code` | `str` | ✅ | — | Source code text |
| `language` | `str` | ❌ | `"text"` | Language for highlighting |

### `aiui.json_view(data)`

A formatted JSON viewer.

```python
aiui.json_view({"status": "ok", "items": [1, 2, 3]})
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `data` | `Any` | ✅ | Any JSON-serializable data |

---

## Form Input Components

### `aiui.text_input(label, *, value, placeholder)`

```python
aiui.text_input("Name", value="Alice", placeholder="Enter name")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Input label |
| `value` | `str` | ❌ | `""` | Default value |
| `placeholder` | `str` | ❌ | `""` | Placeholder text |

### `aiui.number_input(label, *, value, min_val, max_val, step)`

```python
aiui.number_input("Age", value=28, min_val=0, max_val=150, step=1)
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Input label |
| `value` | `int\|float` | ❌ | `0` | Default value |
| `min_val` | `int\|float` | ❌ | `None` | Minimum allowed |
| `max_val` | `int\|float` | ❌ | `None` | Maximum allowed |
| `step` | `int\|float` | ❌ | `1` | Increment step |

### `aiui.select_input(label, *, options, value)`

```python
aiui.select_input("Country", options=["USA", "UK", "Canada"], value="USA")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Input label |
| `options` | `Sequence[str]` | ✅ | — | Option strings |
| `value` | `str` | ❌ | `""` | Default selected |

### `aiui.slider_input(label, *, value, min_val, max_val, step)`

```python
aiui.slider_input("Volume", value=65, min_val=0, max_val=100, step=5)
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Input label |
| `value` | `int\|float` | ❌ | `0` | Default value |
| `min_val` | `int\|float` | ❌ | `0` | Minimum |
| `max_val` | `int\|float` | ❌ | `100` | Maximum |
| `step` | `int\|float` | ❌ | `1` | Increment step |

### `aiui.checkbox_input(label, *, checked)`

```python
aiui.checkbox_input("I agree to the terms", checked=True)
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Checkbox label |
| `checked` | `bool` | ❌ | `False` | Default state |

### `aiui.switch_input(label, *, checked)`

```python
aiui.switch_input("Enable notifications", checked=False)
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Switch label |
| `checked` | `bool` | ❌ | `False` | Default state |

### `aiui.radio_input(label, *, options, value)`

```python
aiui.radio_input("Language", options=["Python", "JavaScript", "Go"], value="Python")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Group label |
| `options` | `Sequence[str]` | ✅ | — | Option strings |
| `value` | `str` | ❌ | `""` | Default selected |

### `aiui.textarea_input(label, *, value, placeholder, rows)`

```python
aiui.textarea_input("Bio", value="Developer", placeholder="About you...", rows=3)
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Input label |
| `value` | `str` | ❌ | `""` | Default value |
| `placeholder` | `str` | ❌ | `""` | Placeholder text |
| `rows` | `int` | ❌ | `4` | Visible rows |

### `aiui.multiselect_input(label, *, options, value)`

```python
aiui.multiselect_input("Tags", options=["AI", "ML", "NLP"], value=["AI"])
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Input label |
| `options` | `Sequence[str]` | ✅ | — | Available choices |
| `value` | `Sequence[str]` | ❌ | `()` | Default selections |

### `aiui.date_input(label, *, value)`

```python
aiui.date_input("Start Date", value="2026-01-15")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Input label |
| `value` | `str` | ❌ | `None` | ISO date string |

### `aiui.time_input(label, *, value)`

```python
aiui.time_input("Alarm", value="08:30")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Input label |
| `value` | `str` | ❌ | `None` | `"HH:MM"` string |

### `aiui.color_picker_input(label, *, value)`

```python
aiui.color_picker_input("Brand Color", value="#6366f1")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Input label |
| `value` | `str` | ❌ | `"#000000"` | Default hex color |

---

## Layout & Advanced Components

### `aiui.container(children, *, title)`

A container wrapper with optional title.

```python
aiui.container([aiui.text("Inside"), aiui.badge("Tag")], title="Section")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `children` | `Sequence[dict]` | ✅ | — | Child component dicts |
| `title` | `str` | ❌ | `None` | Optional heading |

### `aiui.expander(title, *, children, expanded)`

A collapsible section.

```python
aiui.expander("Advanced Settings", children=[aiui.text("Hidden content")], expanded=False)
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | `str` | ✅ | — | Section heading |
| `children` | `Sequence[dict]` | ✅ | — | Content components |
| `expanded` | `bool` | ❌ | `False` | Initially expanded? |

### `aiui.divider(text)`

A horizontal divider with optional center text.

```python
aiui.divider("OR")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | `str` | ❌ | `None` | Label in the middle of the line |

### `aiui.header(text, *, level)`

A heading element.

```python
aiui.header("Dashboard", level=1)
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | `str` | ✅ | — | Heading text |
| `level` | `int` | ❌ | `1` | Heading level 1–6 |

### `aiui.markdown_text(content)`

A markdown-rendered text block.

```python
aiui.markdown_text("**Bold**, *italic*, and `code`.")
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | `str` | ✅ | Markdown content string |

### `aiui.link(text, *, href, external)`

A hyperlink.

```python
aiui.link("Docs", href="https://docs.praison.ai", external=True)
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | `str` | ✅ | — | Link text |
| `href` | `str` | ✅ | — | URL |
| `external` | `bool` | ❌ | `False` | Open in new tab? |

### `aiui.button_group(buttons)`

A row of buttons.

```python
aiui.button_group([
    {"label": "Save", "variant": "default"},
    {"label": "Cancel", "variant": "outline"},
])
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `buttons` | `Sequence[dict]` | ✅ | List of `{"label": str, "variant": str}` |

### `aiui.stat_group(stats)`

A grid of stat/metric cards.

```python
aiui.stat_group([
    {"label": "CPU", "value": "72%", "delta": "+5%"},
    {"label": "Memory", "value": "4.2 GB"},
])
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `stats` | `Sequence[dict]` | ✅ | List of `{"label": str, "value": Any, "delta": str}` |

### `aiui.avatar(*, src, name, fallback)`

An avatar image or initials.

```python
aiui.avatar(name="Alice Smith", fallback="AS")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `src` | `str` | ❌ | `None` | Image URL |
| `name` | `str` | ❌ | `None` | Display name |
| `fallback` | `str` | ❌ | `None` | Fallback text (e.g. initials) |

### `aiui.callout(content, *, variant, title)`

A callout/highlight box.

```python
aiui.callout("Use GPU for faster training.", variant="info", title="Tip")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `content` | `str` | ✅ | — | Callout body text |
| `variant` | `str` | ❌ | `"info"` | `"info"`, `"success"`, `"warning"`, `"error"` |
| `title` | `str` | ❌ | `None` | Optional bold title |

### `aiui.empty(text)`

An empty state placeholder.

```python
aiui.empty("No results found")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | `str` | ❌ | `"No data"` | Placeholder message |

### `aiui.spinner(text)`

A loading spinner with text.

```python
aiui.spinner("Loading data...")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `text` | `str` | ❌ | `"Loading..."` | Loading message |

---

## Media Components

### `aiui.audio_player(src, *, autoplay)`

```python
aiui.audio_player("/audio/clip.mp3", autoplay=False)
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `src` | `str` | ✅ | — | Audio file URL |
| `autoplay` | `bool` | ❌ | `False` | Auto-play? |

### `aiui.video_player(src, *, autoplay, poster)`

```python
aiui.video_player("/video/demo.mp4", poster="/img/thumb.jpg")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `src` | `str` | ✅ | — | Video file URL |
| `autoplay` | `bool` | ❌ | `False` | Auto-play? |
| `poster` | `str` | ❌ | `None` | Poster image URL |

### `aiui.file_download(label, *, href, filename)`

```python
aiui.file_download("Download Report", href="/files/report.pdf", filename="report.pdf")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Button label |
| `href` | `str` | ✅ | — | File URL |
| `filename` | `str` | ❌ | `None` | Suggested filename |

### `aiui.gallery(items)`

An image/media gallery grid.

```python
aiui.gallery([
    {"src": "/img/1.jpg", "alt": "Photo 1", "caption": "Sunset"},
    {"src": "/img/2.jpg", "alt": "Photo 2"},
])
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `items` | `Sequence[dict]` | ✅ | List of `{"src": str, "alt": str, "caption": str}` |

---

## Dashboard Components

### `aiui.toast(message, *, variant, duration)`

A toast notification.

```python
aiui.toast("Saved!", variant="success", duration=3000)
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `message` | `str` | ✅ | — | Notification text |
| `variant` | `str` | ❌ | `"info"` | `"info"`, `"success"`, `"warning"`, `"error"` |
| `duration` | `int` | ❌ | `3000` | Auto-dismiss ms |

### `aiui.dialog(title, *, children, description)`

A modal dialog.

```python
aiui.dialog("Confirm", children=[aiui.text("Are you sure?")], description="This action cannot be undone.")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | `str` | ✅ | — | Dialog heading |
| `children` | `Sequence[dict]` | ✅ | — | Content components |
| `description` | `str` | ❌ | `None` | Subtitle |

### `aiui.caption(text)`

Small muted caption text.

```python
aiui.caption("Figure 1: System architecture")
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | `str` | ✅ | Caption content |

### `aiui.html_embed(content)`

Raw HTML embed (trusted content only).

```python
aiui.html_embed('<iframe src="https://example.com" width="100%"></iframe>')
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | `str` | ✅ | HTML string |

### `aiui.skeleton(*, width, height, variant)`

A skeleton loading placeholder.

```python
aiui.skeleton(width="200px", height="20px", variant="text")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `width` | `str` | ❌ | `None` | CSS width |
| `height` | `str` | ❌ | `None` | CSS height |
| `variant` | `str` | ❌ | `"text"` | `"text"`, `"card"`, or `"avatar"` |

### `aiui.tooltip_wrap(child, *, content)`

Wrap a component with a hover tooltip.

```python
aiui.tooltip_wrap(aiui.badge("Beta"), content="This feature is in beta")
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `child` | `dict` | ✅ | Component to wrap |
| `content` | `str` | ✅ | Tooltip text |

---

## Navigation Components

### `aiui.breadcrumb(items)`

A breadcrumb navigation trail.

```python
aiui.breadcrumb([
    {"label": "Home", "href": "/"},
    {"label": "Settings", "href": "/settings"},
    {"label": "Profile", "href": None},
])
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `items` | `Sequence[dict]` | ✅ | List of `{"label": str, "href": str\|None}` |

### `aiui.pagination(*, total, page, per_page)`

Pagination controls.

```python
aiui.pagination(total=250, page=3, per_page=25)
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `total` | `int` | ✅ | — | Total items |
| `page` | `int` | ❌ | `1` | Current page (1-based) |
| `per_page` | `int` | ❌ | `10` | Items per page |

### `aiui.key_value_list(items, *, title)`

A key-value display list.

```python
aiui.key_value_list([
    {"label": "Model", "value": "gpt-4o-mini"},
    {"label": "Temperature", "value": 0.7},
], title="Config")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `items` | `Sequence[dict]` | ✅ | — | List of `{"label": str, "value": Any}` |
| `title` | `str` | ❌ | `None` | Optional heading |

### `aiui.popover(trigger, *, children)`

A popover overlay triggered by a component.

```python
aiui.popover(aiui.badge("Info"), children=[aiui.text("More details here.")])
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `trigger` | `dict` | ✅ | Component that triggers the popover |
| `children` | `Sequence[dict]` | ✅ | Content inside the popover |

---

## Composition

Components are designed to compose. Use `columns()` for horizontal layout within a `layout()`:

```python
@aiui.page("overview", title="Overview", icon="📊")
async def overview():
    return aiui.layout([
        # Row of KPI cards
        aiui.columns([
            aiui.metric("Users", value=142, delta="+12%"),
            aiui.metric("Revenue", value="$1.5k", delta="+8%"),
            aiui.metric("Uptime", value="99.9%"),
        ]),
        # Tabbed data
        aiui.tabs([
            {"label": "Table", "children": [
                aiui.table(
                    headers=["Agent", "Tasks", "Status"],
                    rows=[["Researcher", 15, "Active"]],
                ),
            ]},
            {"label": "Chart", "children": [
                aiui.chart("Tasks", data=[{"name": "Researcher", "value": 15}]),
            ]},
        ]),
        # Footer
        aiui.text("Data refreshes every 30 seconds."),
    ])
```

## Component Count Summary

| Category | Components | Count |
|----------|-----------|-------|
| Core | `layout`, `card`, `columns`, `table`, `text`, `chart` | 6 |
| Essential | `metric`, `progress_bar`, `alert`, `badge`, `separator`, `tabs`, `accordion`, `image_display`, `code_block`, `json_view` | 10 |
| Form Inputs | `text_input`, `number_input`, `select_input`, `slider_input`, `checkbox_input`, `switch_input`, `radio_input`, `textarea_input`, `multiselect_input`, `date_input`, `time_input`, `color_picker_input` | 12 |
| Layout & Advanced | `container`, `expander`, `divider`, `header`, `markdown_text`, `link`, `button_group`, `stat_group`, `avatar`, `callout`, `empty`, `spinner` | 12 |
| Media | `audio_player`, `video_player`, `file_download`, `gallery` | 4 |
| Dashboard | `toast`, `dialog`, `caption`, `html_embed`, `skeleton`, `tooltip_wrap` | 6 |
| Navigation | `breadcrumb`, `pagination`, `key_value_list`, `popover` | 4 |
| **Total** | | **54** |

## Custom Component Types

The `dashboard.js` renderer supports any dict with a `type` key. Unknown types render as formatted JSON, making it safe to experiment:

```python
# Custom component — renders as JSON until frontend support is added
{"type": "timeline", "events": [{"time": "10:00", "label": "Deploy"}]}
```

---

## Component Render Protocol

Understanding how components flow from Python to the browser.

### Data Flow

```
Python                    Server                     Frontend
──────                    ──────                     ────────
aiui.card("X", value=42)  →  {"type":"card",...}    →  renderComponent()
                             ↓                          ↓
@aiui.page() handler      →  /api/pages/{id}/data   →  renderCard()
                             ↓                          ↓
aiui.layout([...])        →  {"_components":[...]}  →  DOM elements
```

### Step-by-Step

1. **Python**: Call `aiui.card("Revenue", value="$1,500")` — returns a dict:
   ```python
   {"type": "card", "title": "Revenue", "value": "$1,500"}
   ```

2. **Server**: `@aiui.page()` handler returns `aiui.layout([...])`:
   ```python
   {"_components": [{"type": "card", ...}, {"type": "table", ...}]}
   ```

3. **API**: `GET /api/pages/{id}/data` returns the JSON

4. **Frontend**: `dashboard.js` detects `_components` key and calls `renderComponents()`:
   ```javascript
   function renderComponents(data, container) {
       if (data && data._components) {
           data._components.forEach(comp => {
               container.appendChild(renderComponent(comp));
           });
       }
   }
   ```

5. **Renderer**: `renderComponent(comp)` dispatches on `comp.type`:
   ```javascript
   function renderComponent(comp) {
       switch (comp.type) {
           case 'card': return renderCard(comp);
           case 'table': return renderTable(comp);
           // ... 48 component types
           default: return renderAsJSON(comp);
       }
   }
   ```

6. **DOM**: Each renderer creates HTML elements with `db-*` CSS classes

### The `_components` Key

The magic key that triggers structured rendering:

```python
# With _components — renders as UI elements
return {"_components": [aiui.card("X"), aiui.table(...)]}

# Without _components — renders as raw JSON
return {"status": "ok", "data": [...]}
```

`aiui.layout(children)` automatically wraps children in `{"_components": [...]}`.

### Component Dict Protocol

Every component function returns a dict with:

| Key | Required | Description |
|-----|----------|-------------|
| `type` | ✅ | Component type name (e.g. `"card"`, `"table"`) |
| Other keys | Varies | Component-specific properties |

```python
# Card component
{"type": "card", "title": "Revenue", "value": "$1,500", "footer": "+8%"}

# Table component
{"type": "table", "headers": ["A", "B"], "rows": [["x", "y"]]}

# Nested components
{"type": "columns", "children": [
    {"type": "card", "title": "A"},
    {"type": "card", "title": "B"},
]}
```

### CSS Classes

All components use `db-*` prefixed CSS classes:

| Component | CSS Class |
|-----------|-----------|
| Card | `.db-card`, `.db-card-title`, `.db-card-value`, `.db-card-footer` |
| Table | `.db-viewer table` |
| Alert | `.db-alert`, `.db-alert-info`, `.db-alert-success`, etc. |
| Badge | `.db-badge`, `.db-badge-secondary`, `.db-badge-destructive` |
| Tabs | `.db-tabs`, `.db-tab-list`, `.db-tab-btn`, `.db-tab-panel` |

### Extending with Custom Components

To add a new component type:

1. **Python**: Add function to `ui.py`:
   ```python
   def timeline(events: list[dict]) -> dict:
       return {"type": "timeline", "events": events}
   ```

2. **Frontend**: Add renderer to `dashboard.js`:
   ```javascript
   function renderTimeline(comp) {
       const el = document.createElement('div');
       el.className = 'db-timeline';
       // ... render events
       return el;
   }
   
   // Add to switch statement in renderComponent()
   case 'timeline': return renderTimeline(comp);
   ```

3. **CSS**: Add styles for `.db-timeline`

Until the frontend renderer is added, unknown types render as formatted JSON.
