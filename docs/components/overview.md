---
title: UI Components Overview
nav_title: Overview
description: Browse all 76 Python and zero-code YAML UI components plus the built-in Notification Center.
---

# UI Components Overview

PraisonAIUI ships **76 composable UI component builders** plus a built-in **Notification Center**. Every component returns a plain JSON/YAML dictionary, so you can build rich pages in **Python** (`@aiui.page`) or **zero-code YAML** (`pages:` in `app.yaml`) — and register custom React blocks through `@aiui/sdk`.

## Same components in Python or YAML

<Tabs>
<Tab title="Python (@aiui.page)">
```python title="app.py"
import praisonaiui as aiui


@aiui.page("overview", title="Overview", icon="bar-chart-2", group="Workspace")
async def overview():
    return aiui.layout([
        aiui.columns([
            aiui.metric("Active Users", value="1,420", delta="+12%", sparkline=[980, 1120, 1290, 1420]),
            aiui.card("API Status", value="Healthy", footer="99.98% uptime"),
        ]),
        aiui.alert("All background workers are online.", variant="success"),
    ])
```
</Tab>
<Tab title="Zero-code YAML (app.yaml)">
```yaml title="app.yaml"
style: app
pages:
  - chat
  - id: overview
    title: "Overview"
    icon: "bar-chart-2"
    group: "Workspace"
    components:
      - type: columns
        children:
          - type: metric
            label: "Active Users"
            value: "1,420"
            delta: "+12%"
          - type: card
            title: "API Status"
            value: "Healthy"
            footer: "99.98% uptime"
      - type: alert
        variant: "success"
        message: "All background workers are online."
```
</Tab>
</Tabs>

## Browse by category

<CardGroup cols={2}>
<Card title="Layout & Navigation" icon="panels-top-left" href="layout.md">
`layout`, `columns`, `container`, `card`, `card_grid`, `tabs`, `accordion`, `expander`, `list_detail`, `board`, `header`, `divider`, `breadcrumb`, `pagination`, `page_link`.
</Card>
<Card title="Data Display & Charts" icon="bar-chart-2" href="data-display.md">
`metric`, `stat_group`, `table`, `chart` (10 chart types + facets), `badge`, `progress_bar`, `key_value_list`, `definition_list`, `code_block`, `json_view`, `avatar`.
</Card>
<Card title="Inputs, Filters & Forms" icon="sliders-horizontal" href="inputs-and-forms.md">
`form`, `filter_bar`, `button_group`, `text_input`, `select_input`, `multiselect_input`, `segmented_input`, `date_range_input`, `slider_input`, `switch_input`, `color_picker_input`, `tags_input`.
</Card>
<Card title="Feedback & Notifications" icon="bell" href="feedback-and-notifications.md">
`alert`, `callout`, `status`, `toast`, `spinner`, `skeleton`, `empty`, `dialog`, `popover`, `tooltip`, plus the real-time **Notification Center**.
</Card>
<Card title="Media & Content" icon="image" href="media-and-content.md">
`text`, `markdown_text`, `doc_viewer`, `image_display`, `gallery`, `audio_player`, `video_player`, `html`, `html_embed`.
</Card>
<Card title="Full Python Reference" icon="code" href="../api/components.md">
Every parameter, column format, chart option and JSON schema contract.
</Card>
</CardGroup>

## Extend with custom components

Need a custom visualization or widget? Register a React block in a plugin with `registerBlock(type, Component)` from `@aiui/sdk` (see [UI Plugins](../features/plugins.md)), or inspect all active component schemas at `GET /api/components/schemas`.
