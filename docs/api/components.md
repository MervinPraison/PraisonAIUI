---
nav_title: Components
---

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
| `refresh_every` | `float` | ❌ | App shell: re-fetch the page every N seconds while visible (`_refresh_every`) |
| `params` | `dict` | ❌ | In an action reply: values written into the page URL's query string (`_params`) |

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
| `row_ids` | `Sequence[str]` | — | Stable unique ID per row. Makes rows selectable by click, Enter or Space |
| `actions` | `Sequence[str]` | — | Row action button labels (requires `row_ids`) |

With `row_ids`, the dashboard renderer emits bubbling DOM events from the table, so
a custom view can own query state (search, filters, page, sort) and react to rows:

| Event | `detail` |
|-------|----------|
| `aiui:table-select` | `{rowId, index}` |
| `aiui:table-action` | `{action, rowId}` |

Because events carry the stable `rowId`, selection stays correct after the server
re-sorts or filters rows. Loading, empty and error states compose from existing
components (`aiui.skeleton()`, `aiui.empty()`, `aiui.alert()`):

```js
// Custom view: server-paged, searchable table using only documented APIs.
window.aiui.registerView('companies', (container) => {
  const state = { q: '', page: 1 };
  const show = (comps) => { container.replaceChildren(...comps.map(window.aiui.renderComponent)); };
  async function load() {
    show([{ type: 'skeleton', variant: 'card' }]);
    try {
      const res = await fetch(`/api/companies?q=${encodeURIComponent(state.q)}&page=${state.page}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { rows, total } = await res.json();   // [{id, name, status}], count
      if (!rows.length) return show([{ type: 'empty', text: 'No results' }]);
      show([{ type: 'table', headers: ['Name', 'Status'],
              rows: rows.map(r => [r.name, r.status]),
              row_ids: rows.map(r => r.id), actions: ['Edit'] },
            { type: 'caption', text: `${total} companies` }]);
    } catch (e) {
      show([{ type: 'alert', variant: 'error', message: 'Could not load companies. Try again.' }]);
    }
  }
  container.addEventListener('aiui:table-select', (e) => openDetail(e.detail.rowId));
  container.addEventListener('aiui:table-action', (e) => editRow(e.detail.rowId));
  // On search/filter change: state.q = value; state.page = 1; load();
  load();
});
```

### `aiui.text(content)`

A text block.

```python
aiui.text("Last updated 30 seconds ago.")
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `content` | `str` | ✅ | Text content |

### `aiui.chart(title, *, data, chart_type, x, y, ...)`

A chart with tooltips, colours from the theme's `--chart-1..5` tokens (light
and dark) and the full width of its column, down to a phone. The chart
library loads in its own chunk the first time a page shows a chart.

```python
# Horizontal bars with a reference line; bars below it are muted.
aiui.chart(
    "Median lift by day", chart_type="barh",
    data=[{"day": "Mon", "lift": 1.4}, {"day": "Tue", "lift": 0.8}],
    x="day", y="lift",
    reference={"value": 1, "label": "usual"}, color_by_reference=True,
    y_format="multiplier",
)

# A line with faint count bars behind it, on a scale of their own.
aiui.chart(
    "Usual views per month", chart_type="line",
    data=[{"month": "Jan", "views": 12000, "posts": 4}, {"month": "Feb", "views": 15400, "posts": 7}],
    x="month", y="views", y2="posts", labels={"views": "Usual views", "posts": "Posts"},
    y_format="compact",
)

aiui.chart("Retention", chart_type="area", data=points, x="t", y="share", y_format="percent", y_domain=[0, 1])
aiui.chart("Formats mix", data=rows, x="quarter", y=["video", "carousel", "text"], stacked=True)
aiui.chart("Reach", chart_type="scatter", data=channels, x="subs", y="ratio", label="channel")
aiui.chart("Spread of lift", chart_type="histogram", data=[0.4, 1.2, 0.9, 2.5], bins=12)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `title` | `str` | `""` | Chart title |
| `data` | `list[dict]` | `[]` | Rows, e.g. `[{"month": "Jan", "views": 1200}]`. A histogram also takes plain numbers |
| `chart_type` | `str` | `"bar"` | `bar` (columns), `barh` (horizontal bars), `line`, `area`, `scatter`, `pie`, `donut`, `histogram` |
| `x` | `str` | first text column | Category key. Scatter: the x value (default: first numeric column). Histogram: the measured value |
| `y` | `str \| list[str]` | every numeric column | Series key, or keys for several series |
| `y2` | `str` | — | A secondary series drawn as faint bars on its own scale (vertical charts) |
| `labels` | `dict[str, str]` | — | Display names for keys in the legend and tooltip |
| `label` | `str` | — | Scatter: key naming each point in the tooltip |
| `stacked` | `bool` | `False` | Stack the series (`bar`, `barh`, `area`) |
| `reference` | number, list of numbers, `{value, label}` or a list of them | — | Dashed reference lines (a vertical line on `barh`) |
| `color_by_reference` | `bool` | `False` | Bars at or above the first reference keep the series colour; bars below it are muted |
| `x_format`, `y_format` | `str` | — | `number` (1,234.5), `compact` (1.2k, 3.4M), `percent` (0.25 → 25%), `multiplier` (1.5x), `duration` (seconds → 1:05). Axis ticks default to `compact`, tooltips to `number` |
| `y_domain` | `[min, max]` | auto | Value axis range, e.g. `[0, 1]` with `y_format="percent"` |
| `bins` | `int` | Sturges' rule (max 30) | Histogram bin count |
| `height` | `int` | 240 | Plot height in px; `barh` grows with its rows, pie and donut are 260 |
| `caption` | `str` | — | A line of muted text under the chart |
| `legend` | `bool` | more than one series | Show the legend |

An unknown `chart_type` or format raises `ValueError`. A dict written by hand
(`{"type": "chart", "data": [...], "chart_type": "line"}`) works too: missing
keys are inferred from the first row, and `column`, `hbar` and `doughnut` are
accepted as kind names. At most 5,000 rows are drawn. The legacy `dashboard`
style shows a summary card instead of the chart.

---

## Essential Components

### `aiui.metric(label, *, value, delta, delta_color, caption)`

A metric card with optional delta indicator and caption.

```python
aiui.metric("Requests", value="12.3k", delta="+15%")
aiui.metric("Errors", value=23, delta="+3", delta_color="inverse")
aiui.metric("Lead time", value="4 d", delta="-3 days", delta_color="inverse", caption="median")
aiui.metric("Posts", value=51, caption="in the last 30 days")
```

A `delta` that starts with `+`/`↑` or `-`/`↓` (or a signed number) is coloured
as a gain or a loss. Use `caption` for a neutral note under the value, so a
subtitle such as "-2 from plan" is not coloured by accident.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Metric label |
| `value` | `Any` | ✅ | — | Main metric value |
| `delta` | `str` | ❌ | `None` | Change indicator (e.g. "+5%") |
| `delta_color` | `str` | ❌ | `"normal"` | `"normal"` (rise is good), `"inverse"` (fall is good, e.g. `"-3 days"`), or `"off"` (never coloured) |
| `caption` | `str` | ❌ | `None` | Neutral note under the value, never coloured. `help` is an alias |

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
| `message` | `str` | ✅ | — | Alert body: sanitised Markdown in the app shell (lists, bold, links; a single newline breaks the line) |
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
| `lazy` | `bool` | ❌ | App shell: an item without `children` loads when first opened (key: its `load`, else its `label`). See [Server pages](../guides/server-pages.md#4-lazy-tabs-and-expanders) |

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

### `aiui.expander(title, *, children, expanded, lazy, load)`

A collapsible section.

```python
aiui.expander("Advanced Settings", children=[aiui.text("Hidden content")], expanded=False)
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | `str` | ✅ | — | Section heading |
| `children` | `Sequence[dict]` | ❌ | `()` | Content components |
| `expanded` | `bool` | ❌ | `False` | Initially expanded? |
| `lazy` | `bool` | ❌ | `False` | App shell: fetch the body when first opened (`{"_lazy": load}` to the page action) |
| `load` | `str` | ❌ | `title` | Key sent as `_lazy` |

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

The app shell renders sanitised Markdown: `<svg>`, `<script>`, `<style>`,
`style` attributes and event handlers are removed. Put raw HTML and SVG in
[`aiui.html`](#aiuihtmlcontent-height-csp-trusted-title) instead.

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
| `content` | `str` | ✅ | — | Callout body: sanitised Markdown in the app shell (lists, bold, links; a single newline breaks the line) |
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

### `aiui.html(content, *, height, csp, trusted, title)`

App HTML or SVG (a chart, a styled box, a small interactive widget), isolated
from the page.

```python
aiui.html("""
<svg viewBox="0 0 120 40" width="100%">
  <rect width="80" height="12" rx="3" fill="var(--aiui-accent)"/>
  <text x="0" y="32" fill="var(--aiui-muted)" font-size="10">80% done</text>
</svg>""")
aiui.html(table_html, height=320, title="Top posts")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `content` | `str` | ✅ | — | HTML string; may hold `<svg>`, `<style>` and `<script>` |
| `height` | `int\|str` | ❌ | `None` | Fixed height (pixels or a CSS length such as `"20rem"`). Default: fit the content |
| `csp` | `str` | ❌ | `None` | Content-Security-Policy for the frame, replacing the default below |
| `trusted` | `bool` | ❌ | `False` | Render inline in the page instead of in a frame, sanitised (see below) |
| `title` | `str` | ❌ | `None` | Accessible name of the frame (default "Embedded content") |

!!! danger "Security model"
    **Default (sandboxed frame).** In the app shell the content renders in an
    `<iframe sandbox="allow-scripts">` built from `srcdoc`, without
    `allow-same-origin`. Its scripts run in an opaque origin: they cannot read
    or change the app's page, cookies, `localStorage` or session, cannot call
    `/api/*` as the signed-in user, cannot open pop-ups, submit forms or
    navigate the top window. A `<meta http-equiv="Content-Security-Policy">`
    also blocks network access. The default policy is
    `default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'`.
    Pass `csp=` to tighten or loosen it; the frame sizes itself with a small
    inline script, so a policy without `script-src 'unsafe-inline'` needs a
    fixed `height`.

    **`trusted=True` (inline).** The content is placed in the page through
    the sanitised Markdown pipeline (`rehype-sanitize`): scripts, event
    handlers, `style`, `<iframe>` and `<svg>` are removed. Use it for simple
    markup (tables, lists, links) that should flow with the page text; use
    the default frame for SVG and anything with scripts.

    **Never put untrusted text into raw HTML yourself.** Escape values you
    interpolate (`html.escape(...)`) even inside the frame: an injected
    script cannot reach the app, but it can still change what the frame shows.

    **Legacy `dashboard` style.** `html` renders in the same sandboxed frame
    (fixed height, default 320 px). `html_embed` there still sets the HTML
    directly on the page, where scripts and inline handlers run: pass only
    content you wrote.

#### Theme variables

These CSS custom properties are defined on the page in both themes and copied
into every `html` frame, where they follow light/dark changes live:

| Variable | Meaning |
|----------|---------|
| `--aiui-fg` | Body text |
| `--aiui-muted` | Secondary text, axis labels |
| `--aiui-border` | Hairlines, grid lines |
| `--aiui-bg` | Page background |
| `--aiui-surface` | Card / panel background |
| `--aiui-accent` | Brand accent (follows the theme preset) |
| `--aiui-success` / `--aiui-warning` / `--aiui-danger` / `--aiui-info` | Status colours |
| `--aiui-font` / `--aiui-font-mono` | Font stacks |

The frame's body already uses `--aiui-fg` and `--aiui-font` and has a
transparent background, so plain HTML matches the page.

### `aiui.html_embed(content, *, height, csp, trusted, title)`

The older name of [`aiui.html`](#aiuihtmlcontent-height-csp-trusted-title):
same parameters, same sandboxed frame in the app shell. The block keeps its
`html_embed` type, so the legacy `dashboard` style renders it as before
(directly on the page). New code should use `aiui.html`.

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

### `aiui.form(action, *, children, submit_label, method, update_url)`

Collects the inputs inside it by `name` and submits them. Full contract and a
filter-page example: [Server pages](../guides/server-pages.md).

```python
aiui.form("channels", method="get", submit_label="Apply", children=[
    aiui.select_input("Format", name="format", options=["all", "shorts"], value=fmt),
])
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | `str` | ✅ | — | Action id, normally the page id |
| `children` | `Sequence[dict]` | ✅ | — | Inputs and any other blocks |
| `submit_label` | `str` | ❌ | `"Submit"` | Submit button text |
| `method` | `str` | ❌ | `"post"` | `"post"`: POST to `/api/pages/{id}/action`. `"get"` (app shell): write the values into the URL and re-fetch the page (`params`) |
| `update_url` | `bool` | ❌ | `False` | App shell: after a successful POST, also write the values into the URL |

### `aiui.status(label, *, state, detail, progress, log)`

A job status row with an icon per state, an optional progress bar and a log
tail. Pair it with `refresh_every` so it updates while the job runs.

```python
aiui.status("Sync YouTube", state="running", detail="12 of 40 channels", progress=30, log=lines[-20:])
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | What runs |
| `state` | `str` | ❌ | `"running"` | `"queued"`, `"running"`, `"done"` or `"failed"` |
| `detail` | `str` | ❌ | `None` | One line under the label |
| `progress` | `int \| float` | ❌ | `None` | Percent done (0-100, clamped); shows a bar |
| `log` | `Sequence[str]` | ❌ | `None` | Recent log lines (shown with the log viewer) |

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

### `aiui.pagination(*, total, page, per_page, id)`

Pagination controls.

```python
aiui.pagination(total=250, page=3, per_page=25)
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `total` | `int` | ✅ | — | Total items |
| `page` | `int` | ❌ | `1` | Current page (1-based) |
| `per_page` | `int` | ❌ | `10` | Items per page |
| `id` | `str` | ❌ | `None` | Identifier echoed in the page-change event |

The control is optimistic: clicking ←, →, or a page number updates the active
page and dispatches a bubbling `aiui:pagination` DOM event. Buttons that would
go out of bounds are disabled and emit nothing. `page` is clamped to the valid range.

```javascript
container.addEventListener('aiui:pagination', (e) => {
  const { id, page, per_page, total } = e.detail;
  renderRows(rows.slice((page - 1) * per_page, page * per_page)); // or fetch()
});
```

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
| Dashboard | `toast`, `dialog`, `caption`, `html`, `html_embed`, `skeleton`, `tooltip_wrap`, `form`, `status` | 9 |
| Navigation | `breadcrumb`, `pagination`, `key_value_list`, `popover` | 4 |
| **Total** | | **57** |

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
