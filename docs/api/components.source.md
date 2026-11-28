---
nav_title: Components
---

# Component API Reference

Python functions for building app and dashboard UIs. Each function returns a plain dict that the frontend renders as a real UI block — **81 builders** organized by category (usable on `@aiui.page`, in zero-code YAML, and inline inside chat via `await aiui.send_block(...)`). Looking for visual examples in both Python and zero-code YAML? Browse the [UI Components gallery](../components/overview.md).

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

### `aiui.table(*, headers, rows, columns=None, ...)`

A data table. In the app shell it sorts by header click, formats typed
columns, and can search, page, link rows and open a row in a side panel. The
old call shape keeps working unchanged.

```python
aiui.table(
    headers=["Name", "Role"],
    rows=[["Alice", "Engineer"], ["Bob", "Designer"]],
)
```

A larger table with typed columns, dict rows and search:

```python
aiui.table(columns=[
    {"key": "name", "label": "Channel", "type": "link", "href_key": "url"},
    {"key": "subs", "label": "Subscribers", "type": "number", "format": "compact"},
    {"key": "status", "type": "badge", "tones": {"growing": "success", "down": "error"}},
], rows=channels, searchable=True, caption="Channels")  # rows: [{"name", "url", "subs", ...}]
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `headers` | `Sequence[str]` | ✅ unless `columns` | Column header labels |
| `rows` | `Sequence[Sequence \| dict]` | ✅ | Row arrays in column order, or dicts keyed by column `key` (sent as arrays) |
| `columns` | `Sequence[str \| dict]` | — | Column config (below). Gives the headers when `headers` is not set |
| `row_ids` | `Sequence[str]` | — | Stable unique ID per row. Makes rows selectable by click, Enter or Space |
| `actions` | `Sequence[str]` | — | Row action button labels (requires `row_ids`) |
| `searchable` | `bool` | — | A search box that keeps the rows holding every typed word (in the browser) |
| `page_size` | `int` | — | Rows per page; `0` shows every row. Unset: 50 per page once there are more than 100 rows |
| `sortable` | `bool` | — | `False` turns header sorting off. Default on |
| `row_href_key` | `str` | — | Key (in dict rows, or a column key) holding each row's link. The first cell becomes the link and a click on the row opens it |
| `row_detail` | `bool` | — | A click (or Enter) on a row opens a side panel listing the row's fields |
| `detail_key` | `str` | — | Key in dict rows holding a list of block dicts the side panel renders instead of the fields (implies `row_detail`) |
| `detail_load_key` | `str` | — | Key in dict rows holding a lazy section key loaded via `POST /api/pages/{id}/action` (`{"_lazy": key, "_params": ...}`) when that row's side panel opens (implies `row_detail`) |
| `detail_load` | `str` | — | Prefix for lazy row detail keys (`f"{detail_load}{row_id_or_index}"`; implies `row_detail`) |
| `max_height` | `int \| str` | — | Height of the scrolling body (px or CSS length, `0` for none). Default `70vh`, so the header stays in view |
| `caption` | `str` | — | Accessible name of the table and its search box |

Column dict keys: `key`, `label`, `type`, `format`, `decimals`, `tones`,
`tone_above`, `tone_below`, `thresholds`, `href_key`, `width` (px or CSS length),
`align` (`left`, `center`, `right`) and `sortable` (`False` for one column). A
plain string is a column whose key and label are that string.

| `type` | Cell value | Shows |
|--------|-----------|-------|
| `auto` (default) | anything | Text as sent; a column of numbers lines up at the end; `{"text", "href"}` is a link and `{"src", "alt"}` an image |
| `text` | any | The value as text |
| `number` | number (or `{"value", "tone"}`) | Right-aligned, tabular figures. `format`: `compact` (1.2k, 3.4M), `percent` (a fraction: 0.123 → 12.3%), `multiplier` or `x` (2.3x), `fixed` (exactly `decimals`, default 2); none groups digits. `decimals` sets the fraction digits. Optional threshold colouring: `tone_above` (number or `[n, tone]`, default `success`), `tone_below` (number or `[n, tone]`, default `error`), or ordered `thresholds: [{"gte": 1, "tone": "success"}, {"lt": 0.5, "tone": "error"}]` |
| `link` | `{"text", "href", "external"}` or a URL; or text with the column's `href_key` | A link. Only http(s), mailto, tel and relative URLs are kept |
| `badge` | text, or `{"text", "tone"}` | A badge; `tones` maps a value to `success`, `warning`, `error` or `info` |
| `tag` | a list (or comma-separated text) | One badge per item, toned like `badge` |
| `image` | URL, or `{"src", "alt"}` | A small rounded thumbnail (`format: "wide"` for 16:9); `alt` defaults to the column label |
| `progress` | 0..1 | A bar and its percent |
| `date` | ISO text, or epoch seconds or ms | `Nov 22, 2026` in UTC; `format: "datetime"` adds the time, `"iso"` gives `2026-11-22`. Sorts by time |
| `sparkline` | a list of numbers | A small trend line (no axes); sorts by the last point |

A header click sorts ascending, descending, then back to the server's order:
stable, numeric-aware (`1,234`, `1.2k`, `12%`, `2.5x`), empty cells last;
headers are buttons with `aria-sort`. On a phone the table scrolls sideways.
The legacy `dashboard` style draws the dict as a plain text table.

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

# A heatmap: rows x columns from {x, y, value} rows, coloured low to high.
aiui.chart("When posts land", kind="heatmap", data=slots, x="hour", y="weekday", value="posts")

# A sparkline: a tiny line with no axes (plain numbers work).
aiui.chart("Views, last 30 days", kind="sparkline", data=[120, 140, 90, 210, 180])

# Small multiples: one small chart per platform, all on the same value scale.
aiui.chart("Views by platform", chart_type="line", data=rows, x="month", y="views", facet="platform")
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `title` | `str` | `""` | Chart title |
| `data` | `list[dict]` | `[]` | Rows, e.g. `[{"month": "Jan", "views": 1200}]`. A histogram also takes plain numbers |
| `chart_type` | `str` | `"bar"` | `bar` (columns), `barh` (horizontal bars), `line`, `area`, `scatter`, `pie`, `donut`, `histogram`, `heatmap`, `sparkline` |
| `kind` | `str` | — | Alias of `chart_type` |
| `x` | `str` | first text column | Category key. Scatter: the x value (default: first numeric column). Histogram: the measured value |
| `y` | `str \| list[str]` | every numeric column | Series key, or keys for several series |
| `y2` | `str` | — | A secondary series drawn as faint bars on its own scale (`bar`, `barh`, `line`, `area`) |
| `labels` | `dict[str, str]` | — | Display names for keys in the legend and tooltip |
| `label` | `str` | — | Scatter: key naming each point in the tooltip |
| `tooltip` | `list[str \| dict]` | — | Extra row keys (or `{"key", "label", "format"}` dicts) shown in the tooltip (including scatter & heatmap) |
| `stacked` | `bool` | `False` | Stack the series (`bar`, `barh`, `area`) |
| `reference` | number, list of numbers, `{value, label}` or a list of them | — | Dashed reference lines (a vertical line on `barh`) |
| `color_by_reference` | `bool` | `False` | Bars at or above the first reference keep the series colour; bars below it are muted |
| `x_format`, `y_format` | `str` | — | `number` (1,234.5), `compact` (1.2k, 3.4M), `percent` (0.25 → 25%), `multiplier` (1.5x), `duration` (seconds → 1:05). Axis ticks default to `compact`, tooltips to `number` |
| `x_domain`, `y_domain` | `[min, max]` | auto | X / value axis range, e.g. `x_domain=[1e3, 1e7]` on scatter or `y_domain=[0, 1]` with `y_format="percent"` |
| `x_scale`, `y_scale` | `str` | `"linear"` | `"linear"` or `"log"` (non-positive values are omitted safely) |
| `clip` | `bool \| number \| [min, max]` | — | Clamp outliers to `x_domain`/`y_domain` (`True`), an upper cap (number), or `[min, max]` (histogram edge bins show `≤`/`+`; heatmap colour scale clamps to bounds) |
| `bins` | `int` | Sturges' rule (max 30) | Histogram bin count |
| `height` | `int` | 240 | Plot height in px; `barh` grows with its rows, pie and donut are 260 |
| `caption` | `str` | — | A line of muted text under the chart |
| `legend` | `bool` | more than one series | Show the legend |
| `value` | `str` | `"value"` | Heatmap: the cell value key. `x` is the column key and `y` the row key (defaults `x` and `y`) |
| `facet` | `str` | — | Key whose values split the rows into small charts in a responsive grid (at most 24 panels) |
| `facet_scales` | `str` | `"shared"` | `"shared"` (one value scale across all panels) or `"free"` (each panel scales to its own data) |

**Heatmap.** Columns and rows keep the order they first appear in `data`,
so sort the rows (Mon..Sun, 0..23) before passing them; a repeated cell
sums. Cells are coloured on a sequential scale from the theme's first chart
colour (light and dark), empty cells are outlined, `y_format` formats the
values in the tooltip and the colour scale under the grid, and `y_domain`
fixes the scale. Cells keep a minimum width, so a wide grid scrolls sideways
inside the chart on a phone.

**Sparkline.** One series, no axes, the last value printed beside it;
`height` defaults to 48 px. A number list under a metric is
`aiui.metric(..., sparkline=[...])`.

**Small multiples.** With `facet`, each panel is 160 px high (48 for a
sparkline) unless `height` is set, panels follow first-seen order, and the
legend is shown once. `y_domain` overrides the shared scale.

An unknown `chart_type` or format raises `ValueError`. A dict written by hand
(`{"type": "chart", "data": [...], "chart_type": "line"}`) works too: missing
keys are inferred from the first row, and `column`, `hbar` and `doughnut` are
accepted as kind names. At most 5,000 rows are drawn. The legacy `dashboard`
style shows a summary card instead of the chart.

---

## Essential Components

### `aiui.metric(label, *, value, delta, delta_color, caption, sparkline, benchmark, benchmark_label)`

A metric card with optional delta indicator and caption.

```python
aiui.metric("Requests", value="12.3k", delta="+15%")
aiui.metric("Errors", value=23, delta="+3", delta_color="inverse")
aiui.metric("Lead time", value="4 d", delta="-3 days", delta_color="inverse", caption="median")
aiui.metric("Posts", value=51, caption="in the last 30 days")
aiui.metric("Engagement", value=0.024, benchmark=0.41, benchmark_label="median")  # "17x below median (0.41)"
aiui.metric("Views", value="12.3k", sparkline=[8200, 9100, 10400, 12300])
```

`benchmark` compares a numeric `value` with a reference: a ratio of 2 or
more reads as a multiple ("17x below median"), a smaller one as a percentage
("25% above median"), and it is coloured like a delta (`delta_color`
applies, so `"inverse"` makes "above" the loss). `sparkline` draws the
numbers as a tiny trend line under the value.

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
| `sparkline` | `list[float]` | ❌ | `None` | Numbers drawn as a tiny trend line under the value |
| `benchmark` | `float` | ❌ | `None` | Reference the value is compared with ("17x below median") |
| `benchmark_label` | `str` | ❌ | `"benchmark"` | Name of the benchmark in that line |

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

### `aiui.select_input(label, *, options, value, name, searchable, auto_submit, options_url, placeholder, selected_label)`

```python
aiui.select_input("Country", options=["USA", "UK", "Canada"], value="USA")
aiui.select_input("Channel", options=channels, name="channel")  # 1,000+ options: searchable
aiui.select_input(
    "Creator",
    options_url="/api/creators/search",
    value=creator_id,
    selected_label=creator_name,
    placeholder="Search creators...",
    name="creator",
)
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Input label |
| `options` | `Sequence[str \| dict]` | ❌ | `()` | Option strings, or `{"value", "label"}` dicts (optional when `options_url` is set) |
| `value` | `str` | ❌ | `""` | Default selected |
| `name` | `str` | ❌ | `None` | Submit key in a form (else `label`) |
| `searchable` | `bool` | ❌ | `None` | `True`: a type-to-search list (combobox). `None`: searchable when there are more than 20 options or `options_url` is set. `False`: always a plain dropdown |
| `auto_submit` | `bool` | ❌ | `False` | Submit the enclosing form when the value changes |
| `options_url` | `str` | ❌ | `None` | Endpoint queried with `?q=<text>` (debounced 200 ms) returning `[{"value", "label"}]`, `["str"]`, or `{"options": [...]}` |
| `placeholder` | `str` | ❌ | `None` | Placeholder text shown when no value is selected |
| `selected_label` | `str` | ❌ | `None` | Display label for the initial `value` when `options_url` is used and `options` is omitted |

In the app shell the searchable list filters as you type (names that start
with the text first) and renders at most 100 rows, with a "N more: type to
narrow" line, so a list of a thousand options opens instantly. When
`options_url` is set, typing queries the server endpoint with `?q=...` and
remembers chosen labels across searches. Arrow keys, Enter and Escape work as
in any listbox; the value posts by `name` like a plain select.

`auto_submit=True` is also accepted by `text_input` (debounced 400 ms),
`number_input`, `slider_input`, `textarea_input`, `checkbox_input`,
`switch_input`, `radio_input`, `date_input`, `time_input` and
`color_picker_input`.

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

### `aiui.multiselect_input(label, *, options, value, name, placeholder, auto_submit, options_url, selected_labels)`

```python
aiui.multiselect_input("Tags", options=["AI", "ML", "NLP"], value=["AI"], name="tags")
aiui.multiselect_input("Topics", options_url="/api/topics/search", value=["t1"], selected_labels={"t1": "AI"}, name="topics")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Input label |
| `options` | `Sequence[str \| dict]` | ❌ | `()` | Choices: strings or `{"value", "label"}` dicts (optional when `options_url` is set) |
| `value` | `Sequence[str]` | ❌ | `()` | Default selections |
| `name` | `str` | ❌ | `None` | Submit key in a form (else `label`) |
| `placeholder` | `str` | ❌ | `None` | Text of the add button while nothing is chosen |
| `auto_submit` | `bool` | ❌ | `False` | Submit the form when the selection changes |
| `options_url` | `str` | ❌ | `None` | Endpoint queried with `?q=<text>` (debounced 200 ms) for remote options |
| `selected_labels` | `dict[str, str]` | ❌ | `None` | Initial `{value: label}` map so chips show labels before a search runs |

Chosen values show as chips with a remove button; "Add" opens a searchable
list. In a form it posts a **list** of the chosen values.

### `aiui.tags_input(label, *, value, name, placeholder, auto_submit)`

```python
aiui.tags_input("Tags", value=["ai"], name="tags")
```

Free-text tags: Enter or a comma turns the typed text into a chip (pasted
`a, b, c` makes three), Backspace in the empty box removes the last one.
Blank and duplicate tags are dropped. Posts a **list** of strings.

### `aiui.date_range_input(name, *, label, start, end, presets, auto_submit)`

```python
aiui.date_range_input("posted", label="Posted", presets=[7, 30, 90, 365])
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `name` | `str` | ✅ | — | Submit-key prefix |
| `label` | `str` | ❌ | `None` | Label above the control |
| `start` / `end` | `str` | ❌ | `None` | Default ISO dates |
| `presets` | `Sequence[int\|dict]` | ❌ | `(7, 30, 90, 365)` | Day counts, or `{"days": 14, "label": "2 weeks"}`; `()` hides them |
| `auto_submit` | `bool` | ❌ | `False` | Submit the form when the range changes |

Preset buttons and two native date fields. It posts **`<name>_start`** and
**`<name>_end`** (`"2026-01-31"`, or `""` for an open side). A preset sets
the end to today and the start that many days earlier, in the browser's local
date; the preset whose range matches is shown as pressed.

### `aiui.segmented_input(name, options, *, label, value, multi, auto_submit)`

```python
aiui.segmented_input("sort", [{"value": "views", "label": "Views"}, {"value": "date", "label": "Newest"}], value="views")
aiui.segmented_input("platform", ["YouTube", "LinkedIn", "X"], multi=True)
```

A row of toggle pills (`aria-pressed`). Single choice posts the value (the
first option when `value` is empty); `multi=True` posts a **list**.

### `aiui.date_input(label, *, value, name, auto_submit)`

```python
aiui.date_input("Start Date", value="2026-01-15", name="start_date")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Input label |
| `value` | `str` | ❌ | `None` | ISO date string |
| `name` | `str` | ❌ | `None` | Submit key in a form (else `label`) |
| `auto_submit` | `bool` | ❌ | `False` | Submit the enclosing form on change |

### `aiui.time_input(label, *, value, name, auto_submit)`

```python
aiui.time_input("Alarm", value="08:30", name="alarm")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Input label |
| `value` | `str` | ❌ | `None` | `"HH:MM"` string |
| `name` | `str` | ❌ | `None` | Submit key in a form (else `label`) |
| `auto_submit` | `bool` | ❌ | `False` | Submit the enclosing form on change |

### `aiui.color_picker_input(label, *, value, name, auto_submit)`

```python
aiui.color_picker_input("Brand Color", value="#6366f1", name="brand_color")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Input label |
| `value` | `str` | ❌ | `"#000000"` | Default hex color |
| `name` | `str` | ❌ | `None` | Submit key in a form (else `label`) |
| `auto_submit` | `bool` | ❌ | `False` | Submit the enclosing form on change |

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

### `aiui.markdown_text(content, *, toc, title)`

A markdown-rendered text block.

```python
aiui.markdown_text("**Bold**, *italic*, and `code`.")
aiui.markdown_text(guide_md, toc=True, title="Architecture Guide")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `content` | `str` | ✅ | — | Markdown content string |
| `toc` | `bool` | ❌ | `False` | App shell: show an "On this page" table of contents for `##` / `###` headings (sticky on desktop, collapsible on mobile) |
| `title` | `str` | ❌ | `None` | Optional document heading above the rendered markdown |

`aiui.doc_viewer(content, *, title=None, toc=True)` is a convenience wrapper
around `markdown_text(..., toc=True)`.

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

### `aiui.link_button(label, href, *, variant, external)` and `aiui.page_link(page_id, label, *, variant, params)`

`link_button` is a link drawn as a button (`variant`: `"outline"` default,
`"primary"`, `"secondary"`, `"ghost"`, `"link"`). `page_link` links to another
page of the app by id; in the app shell a click opens it in place (no reload),
Ctrl/Cmd-click still opens a new tab, `params` appends query parameters to the
target URL, and `variant` draws it as a button. Both return a `link` dict, so
the legacy dashboard shows a plain link. Gallery items, `card_grid` cards,
breadcrumbs, table `link` cells and `button_group` items also accept `page`
with optional `params` (and same-origin `/page?k=v` hrefs navigate in place in
the app shell).

```python
aiui.link_button("Open report", "/files/report.html", variant="primary", external=True)
aiui.page_link("sync", "Go to Sync")
aiui.page_link("creators", "Browse creators", variant="outline", params={"tier": "top"})
```

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

### `aiui.avatar(*, src, name, fallback, size)`

An avatar image, else `fallback` or the initials of `name` (its accessible label).

```python
aiui.avatar(name="Alice Smith", src="/img/alice.png", size="lg")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `src` | `str` | ❌ | `None` | Image URL |
| `name` | `str` | ❌ | `None` | Display name |
| `fallback` | `str` | ❌ | `None` | Fallback text (e.g. initials) |
| `size` | `str` | ❌ | `None` | `"sm"`, `"default"` or `"lg"` |

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

### `aiui.audio_player(src, *, autoplay, title)`

```python
aiui.audio_player("/audio/clip.mp3", title="Episode 12")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `src` | `str` | ✅ | — | Audio file URL |
| `autoplay` | `bool` | ❌ | `False` | Auto-play? |
| `title` | `str` | ❌ | `None` | Caption under the player, also its accessible name |

### `aiui.video_player(src, *, autoplay, poster, title)`

```python
aiui.video_player("/video/demo.mp4", poster="/img/thumb.jpg", title="Product demo")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `src` | `str` | ✅ | — | Video file URL |
| `autoplay` | `bool` | ❌ | `False` | Auto-play (muted, as browsers require) |
| `poster` | `str` | ❌ | `None` | Poster image URL |
| `title` | `str` | ❌ | `None` | Caption under the player, also its accessible name |

### `aiui.file_download(label, *, href, filename, variant)`

A download button (a link with the `download` attribute).

```python
aiui.file_download("Download Report", href="/files/report.pdf", filename="report.pdf")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `label` | `str` | ✅ | — | Button label |
| `href` | `str` | ✅ | — | File URL |
| `filename` | `str` | ❌ | `None` | Suggested filename |
| `variant` | `str` | ❌ | `None` | Button look (`"outline"` when unset, `"primary"`, `"secondary"`, `"ghost"`) |

### `aiui.gallery(items)`

An image/media gallery grid.

```python
aiui.gallery([
    {"src": "/img/1.jpg", "alt": "Photo 1", "caption": "Sunset"},
    {"src": "/img/2.jpg", "title": "Docs", "href": "https://docs.praison.ai", "target": "_blank"},
    {"src": "/img/launch.jpg", "title": "Launch video", "video": "/video/launch.mp4"},
    {"title": "Sync status", "page": "sync"},
])
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `items` | `Sequence[dict]` | ✅ | List of `{"src": str, "alt": str, "caption": str}` |

Optional per item: `title`, `subtitle`, `tag`, `description`, and a link that
makes the whole tile clickable and keyboard focusable: `href` (+ `target`, e.g.
`"_blank"`), `page` (an app page id, opened in place, with optional `params`) or
`video` (a video URL: the thumbnail gets a play mark and opens it, in a new tab
unless `target` is set). When both `title` and `caption` are given, `caption`
renders visibly under the title alongside any `subtitle`.

### `aiui.card_grid(items, *, columns)`

A responsive grid of entity cards (a person, channel, product, ...). It shows
`columns` cards per row on a wide page, two at medium width and one on a phone.

```python
aiui.card_grid([{
    "title": "Ada Lovelace", "subtitle": "@ada", "avatar": "/img/ada.png", "badges": ["Top 10"],
    "stats": [{"label": "Median views", "value": "41k"}, {"label": "Lift", "value": "2.4x"}],
    "page": "creator-ada",
}], columns=3)
```

`columns` (1-6, default 3) is the number per row on a wide page. Item keys: `title` (required), `subtitle`, `description` (two lines),
`image` (cover image), `avatar` (round image URL; `True` shows the title's
initials), `badges` (strings or `{"text", "variant"}`), `stats`
(`[{"label", "value"}]`), and `href` (+ `target`) or `page` to make the whole
card a link.

### `aiui.list_detail(*, rows, columns, title, page_size, search, empty)`

A list with a detail panel beside it (below it on a phone): a dense table with
a sticky header, a search box, keyboard selection (Up and Down move, Enter
opens, Escape closes) and pages. Selecting a row shows its other columns and
its `detail` dict as key facts.

```python
aiui.list_detail(
    title="Sessions",
    columns=["title", {"key": "tokens", "align": "end"}],
    rows=[{"id": "s1", "title": "Sorting", "tokens": 3412, "detail": {"Cost": "$0.02"}}],
)
```

| Key | Type | Description |
|-----|------|-------------|
| `title` (or `label`) | `str` | Accessible name, also used in the search label. Default `Items` |
| `columns` | `list[str \| dict]` | `{"key", "label", "align"}` (`align`: `end` or `right` for numbers), or plain keys. Unset: the keys of the first row except `id` and `detail` |
| `rows` | `list[dict]` | One dict per row: `id` (default: its index), a value per column key, and an optional `detail` dict shown in the panel |
| `page_size` | `int` | Rows per page. Default 25 |
| `search` | `bool` | Show the search box even when every row fits on one page (it shows by itself past one page) |
| `empty` | `str` | Text shown when there are no rows |

Use `aiui.table(...)` instead when the list needs typed cells or header
sorting (`row_detail=True` or `detail_key` give it a side panel).

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

### `aiui.dialog(title, *, children, description, trigger_label, variant)`

A button that opens a modal dialog with child components (forms and buttons
inside post to the page action as usual).

```python
aiui.dialog("Channel details", trigger_label="Details", children=[aiui.text("1.2M subscribers")])
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | `str` | ✅ | — | Dialog heading |
| `children` | `Sequence[dict]` | ✅ | — | Content components |
| `description` | `str` | ❌ | `None` | Subtitle |
| `trigger_label` | `str` | ❌ | `title` | Text of the button that opens it |
| `variant` | `str` | ❌ | `None` | Look of that button (`"outline"` when unset, `"primary"`, ...) |

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

Wrap a component with a tooltip shown on hover and keyboard focus (a badge or
text child becomes a tab stop). `aiui.tooltip(child, content=...)` is the same.

```python
aiui.tooltip(aiui.badge("Beta"), content="This feature is in beta")
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

### `aiui.pagination(*, total, page, per_page, id, action)`

Pagination controls.

```python
aiui.pagination(total=250, page=3, per_page=25)
aiui.pagination(total=250, page=3, per_page=25, action="explore")
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `total` | `int` | ✅ | — | Total items |
| `page` | `int` | ❌ | `1` | Current page (1-based) |
| `per_page` | `int` | ❌ | `10` | Items per page |
| `id` | `str` | ❌ | `None` | Identifier echoed in the page-change event |
| `action` | `str` | ❌ | `None` | App shell: POST `{id, page, per_page, total}` to `/api/pages/{page}/action` |

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

A panel of child components, opened by the trigger (click, Enter or Space). A
`button` trigger is drawn as a button with its `label`.

```python
aiui.popover(aiui.badge("Info"), children=[aiui.text("More details here.")])
aiui.popover({"type": "button", "label": "Filters"}, children=[aiui.select_input("Format", options=["Short", "Long"])])
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

## Forms and filters

### `aiui.form(action, *, children, submit_label, submit_on_change)`

```python
aiui.form("settings", children=[...], submit_label="Save")
aiui.form("explore", children=[...], submit_on_change=True)
```

On submit the form POSTs every input by `name` (else `label`) as JSON to
`/api/pages/{page}/action`, handled by `@aiui.register_page_action(action)`;
`action` is normally the page id. If the handler returns a block tree
(`aiui.layout([...])`, i.e. `{"_components": [...]}`) the page re-renders with
it; a reply with `message` shows a toast instead.

`submit_on_change=True` submits whenever an input changes: right away for
selects, pills, chips, checkboxes and dates, 400 ms after the last keystroke
for text. A submit with the same values as the last one is skipped, and a
change made while one is in flight posts once more when it returns. Leave it
off for a form whose button starts a job; mark single inputs with
`auto_submit=True` instead.

### `aiui.filter_bar(action, *, inputs, chips, defaults, reset_label, method, update_url)`

```python
@aiui.page("explore", title="Explore")
async def explore(params):
    return aiui.layout([
        aiui.filter_bar(method="get", defaults={"channel": "All"}, inputs=[
            aiui.select_input("Channel", options=["All", *channels], value=params.get("channel", "All"), name="channel"),
            aiui.multiselect_input("Format", options=formats, value=params.get("formats", []), name="formats"),
            aiui.date_range_input("posted", label="Posted", start=params.get("posted_start"), end=params.get("posted_end")),
        ]),
        aiui.table(headers=[...], rows=query(params)),
    ])
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | `str` | ❌ | `""` | Action id (normally the page id; optional with `method="get"`) |
| `inputs` | `Sequence[dict]` | ✅ | — | Input components |
| `chips` | `bool` | ❌ | `True` | Show active filters as removable chips |
| `defaults` | `dict` | ❌ | `None` | Reset value per input name (`{"start", "end"}` for a date range) |
| `reset_label` | `str` | ❌ | `"Reset"` | Label of the control that clears all filters |
| `method` | `str` | ❌ | `"post"` | `"get"` writes filter values into the page URL and re-fetches page data (no action handler needed) |
| `update_url` | `bool` | ❌ | `False` | With `method="post"`, also write submitted values into the page URL after a successful action |

A compact wrapping row (a `search` landmark) that posts like `form` with
`submit_on_change`. Under it, each active filter is a chip ("Channel: Ann ×",
one chip per value of a list); the × posts the form with that filter reset,
and Reset posts all of them reset. A filter is active when its value differs
from its reset value: `defaults[name]`, else the first option of a select,
radio or single segmented input, else empty; number and slider inputs only
when `defaults` names them. Chips are read from the values the server sent,
so the handler must return the page rebuilt from the posted values.
A full example: `examples/python/32-filter-page/app.py`.

`tags_input`, `date_range_input`, `segmented_input` and `filter_bar` render
in the app shell (the default style); the legacy `dashboard` style shows them
as JSON.

## Component Count Summary

| Category | Components | Count |
|----------|-----------|-------|
| Core | `layout`, `card`, `columns`, `table`, `text`, `chart` | 6 |
| Essential | `metric`, `progress_bar`, `alert`, `badge`, `separator`, `tabs`, `accordion`, `image_display`, `code_block`, `json_view` | 10 |
| Form Inputs | `text_input`, `number_input`, `select_input`, `slider_input`, `checkbox_input`, `switch_input`, `radio_input`, `textarea_input`, `multiselect_input`, `tags_input`, `date_input`, `date_range_input`, `time_input`, `segmented_input`, `color_picker_input` | 15 |
| Forms | `form`, `filter_bar` | 2 |
| Layout & Advanced | `container`, `expander`, `divider`, `header`, `markdown_text`, `link`, `link_button`, `page_link`, `button_group`, `stat_group`, `avatar`, `callout`, `empty`, `spinner` | 14 |
| Media | `audio_player`, `video_player`, `file_download`, `gallery`, `card_grid` | 5 |
| Dashboard | `toast`, `dialog`, `caption`, `html`, `html_embed`, `skeleton`, `tooltip_wrap`, `status` | 8 |
| Navigation | `breadcrumb`, `pagination`, `key_value_list`, `popover` | 4 |
| **Total** | | **64** |

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

### `aiui.board(*, columns)`

A Kanban-style board with horizontal columns of cards.

```python
aiui.board(columns=[
    {"title": "To Do", "cards": [aiui.card("Write docs", footer="agent-a")]},
    {"title": "Done", "cards": [aiui.card("Ship v0.3", footer="agent-b")]},
])
```

### `aiui.definition_list(items, *, title=None)`

A structured label/value definition list (`[{"label": ..., "value": ...}]`).

```python
aiui.definition_list(
    [{"label": "Runtime", "value": "Python 3.12"}, {"label": "Shell", "value": "React App"}],
    title="Environment",
)
```

### `aiui.stepper(steps, *, active=0, orientation="horizontal", title=None)`

Multi-step workflow or onboarding progress bar (`steps` items accept `label`, optional `description`, and `status`: `"pending"` | `"active"` | `"done"` | `"error"`).

```python
aiui.stepper([
    {"label": "Connect", "status": "done"},
    {"label": "Index Docs", "status": "active"},
    {"label": "Deploy", "status": "pending"},
], active=1)
```

### `aiui.timeline(items, *, title=None)`

Chronological vertical activity or audit feed (`items` accept `title`, optional `time`, `description`, `status`).

```python
aiui.timeline([
    {"title": "Agent started", "time": "10:01", "status": "done"},
    {"title": "Tool approved", "time": "10:02", "status": "active"},
], title="Run Activity")
```

### `aiui.diff_viewer(before, after, *, title=None, before_label="Before", after_label="After")`

Line-by-line text/code diff viewer highlighting additions and removals.

```python
aiui.diff_viewer("model = 'gpt-4o-mini'\n", "model = 'gpt-4o'\n", title="Config Diff")
```

### `aiui.tree_view(nodes, *, title=None, default_expanded=False)`

Collapsible hierarchical tree for files, RAG sources, or nested agent runs (`nodes` accept `label`, optional `meta`, `children`).

```python
aiui.tree_view([{"label": "docs/", "children": [{"label": "index.md"}]}], default_expanded=True)
```

### `aiui.copy_field(value, *, label=None, secret=False)`

Read-only copyable value field (API keys, webhook URLs, commands) with optional secret masking (`secret=True`).

```python
aiui.copy_field("sk-live-example", label="API Key", secret=True)
```

### `aiui.rating_input(label="", *, value=0, max_stars=5, name=None, readonly=False, auto_submit=False)`

Interactive star rating input (or read-only score display when `readonly=True`).

```python
aiui.rating_input("Response quality", value=4, max_stars=5, name="rating")
```

### `aiui.sheet(title="Spreadsheet", *, headers=None, rows=None, tabs=None, id=None, action=None, save_label="Save")`

Interactive multi-tab spreadsheet with live cell editing, zero-`eval` formulas (`=SUM`, `=AVERAGE`, `=IF`), row search, CSV/JSON export, and optional `action=` Save callback to `@aiui.register_page_action`.

```python
aiui.sheet(
    "Q4 Budget",
    headers=["Item", "Cost"],
    rows=[["Compute", 4200], ["Storage", 1100], ["Total", "=SUM(B2:B3)"]],
    action="save_budget",
)
```

### `aiui.whiteboard(items, *, title="Whiteboard", id=None)`

Interactive whiteboard canvas with draggable stickies, shapes, groups, connected arrows, zoom controls, and SVG/JSON export.

```python
aiui.whiteboard([
    {"id": "n1", "type": "sticky", "text": "Plan", "x": 40, "y": 40, "color": "amber"},
    {"id": "n2", "type": "sticky", "text": "Ship", "x": 260, "y": 40, "color": "emerald"},
    {"type": "arrow", "from": "n1", "to": "n2"},
], title="Architecture Board")
```

### `aiui.plotly_chart(fig, title="", *, height=None, caption=None)`

Convert a standard Plotly figure (or figure dict) into a native Recharts `chart` block (`bar`, `barh`, `line`, `area`, `scatter`, `pie`, `donut`, `histogram`, `heatmap`) without bundling `plotly.js`. Unsupported trace types degrade cleanly to an alert + `json_view`.

```python
aiui.plotly_chart(fig, title="Revenue by Quarter")
```

### `aiui.file_upload(label="Upload file", *, name="files", accept=None, multiple=False, max_size_mb=10, help_text=None, auto_submit=False)`

Drag-and-drop file uploader that posts files to the authenticated `POST /api/chat/attachments` endpoint and submits safe handles (`{id, filename, content_type, size}`). Resolve handles server-side with `aiui.get_uploaded_file()`.

```python
aiui.file_upload("Drop a CSV or PDF", name="doc", accept=".csv,.pdf", max_size_mb=10)
```

### `aiui.chat_panel(*, title="Agent Chat", agent=None, height=520, session_id=None, welcome=None)`

Embed a compact, streaming Agent Chat panel inside any `@aiui.page` layout (for example, beside a table, chart, or document viewer inside `aiui.columns([...])`).

```python
aiui.columns([
    aiui.doc_viewer(content=spec_md, title="Spec"),
    aiui.chat_panel(title="Ask about this spec", height=540),
])
```

### `aiui.form_action(action, *, children, submit_label="Submit")`

Deprecated alias for `aiui.form()`. Prefer `aiui.form(...)` in new code.

### Extending with Custom Components

In the React app shell (`style: app`), register new block types through `@aiui/sdk` without touching core files:

```tsx
import { registerBlock } from '@aiui/sdk'

registerBlock('timeline', ({ block }) => (
  <div>{(block.events as Array<{ label: string }>).map((e, i) => <div key={i}>{e.label}</div>)}</div>
))
```

Optionally register a JSON Schema contract in Python with `aiui.register_component_schema("timeline", ...)` (see [UI Plugins](../features/plugins.md)). Unknown component types render safely as formatted JSON.
