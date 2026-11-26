---
title: Inputs, Filters & Forms
nav_title: Inputs & forms
description: Build URL-synced filter bars, interactive POST forms, selects, multi-selects, date ranges, sliders, switches and action buttons.
---

# Inputs, Filters & Forms

Collect user input, filter tables via URL query strings (`method="get"`), or submit changes to `@aiui.register_page_action()` (`method="post"`). Every input supports `auto_submit=True` for instant filtering.

## Quick catalog

| Python builder | YAML `type` | Purpose |
|---|---|---|
| `aiui.form(action, *, children, submit_label, method, update_url)` | `form` | Groups inputs; `method="get"` syncs URL params, `method="post"` calls page action |
| `aiui.filter_bar(action, *, inputs, chips, defaults, reset_label, method, update_url)` | `filter_bar` | Compact auto-applying filter row with active filter chips & Reset button |
| `aiui.button_group(buttons)` | `button_group` | Action buttons (`label`, `action`, `variant`, optional payload) |
| `aiui.text_input(label, *, value, placeholder, name, auto_submit)` | `text_input` | Single-line text or search field |
| `aiui.textarea_input(label, *, value, placeholder, rows, name)` | `textarea_input` | Multi-line text editor |
| `aiui.number_input(label, *, value, min_val, max_val, step, name)` | `number_input` | Numeric field with bounds & step |
| `aiui.select_input(label, *, options, value, name, searchable, options_url)` | `select_input` | Single choice dropdown (supports search & remote `options_url`) |
| `aiui.multiselect_input(label, *, options, value, name, options_url)` | `multiselect_input` | Searchable multi-select with removable chips |
| `aiui.segmented_input(name, options, *, label, value, multi)` | `segmented_input` | Pill toggle buttons (single or multi-select) |
| `aiui.radio_input(label, *, options, value, name)` | `radio_input` | Radio group |
| `aiui.checkbox_input(label, *, checked, name)` | `checkbox_input` | Boolean checkbox |
| `aiui.switch_input(label, *, checked, name)` | `switch_input` | Toggle switch |
| `aiui.slider_input(label, *, value, min_val, max_val, step, name)` | `slider_input` | Range slider |
| `aiui.date_input(label, *, value, name)` | `date_input` | Single date picker |
| `aiui.date_range_input(name, *, label, start, end, presets)` | `date_range_input` | Preset buttons (`Last 7/30/90 days`) + start/end dates |
| `aiui.time_input(label, *, value, name)` | `time_input` | Time picker |
| `aiui.color_picker_input(label, *, value, name)` | `color_picker_input` | Hex color picker |
| `aiui.tags_input(label, *, value, name, placeholder)` | `tags_input` | Free-text tag chips |
| `aiui.file_download(label, *, href, filename, variant)` | `file_download` | Download trigger button |

## Instant URL-synced filter bar example

```python title="app.py"
import praisonaiui as aiui


@aiui.page("explorer", title="Explorer", icon="search", group="Workspace")
async def explorer(params):
    q = params.get("q", "")
    status = params.get("status", "all")
    return aiui.layout([
        aiui.filter_bar(
            "explorer",
            method="get",
            defaults={"status": "all"},
            inputs=[
                aiui.text_input("Search", name="q", value=q, placeholder="Filter by title..."),
                aiui.segmented_input("status", ["all", "active", "archived"], value=status),
            ],
        ),
        aiui.caption(f"Showing status={status!r}, query={q!r}"),
    ])
```

<Tip>
With `method="get"`, active filters live in the browser URL (`/explorer?status=active&q=api`), so bookmarks, refreshes, and shared links keep the exact same view.
</Tip>
