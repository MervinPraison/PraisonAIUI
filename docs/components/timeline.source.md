---
title: Timeline
nav_title: Timeline
description: Chronological activity feed and audit trail with status-colored markers and timestamps.
---

# Timeline

`timeline()` displays a vertical chronological log of agent steps, deployments, or audit events with color-coded status markers (`default`, `info`, `success`, `warning`, `error`).

<ComponentPreview title="Activity Timeline">
{
  "type": "timeline",
  "title": "Recent Deployment Events",
  "items": [
    {"title": "Release v0.3.183 live", "time": "2m ago", "status": "success", "description": "Published wheel to PyPI and deployed docs to GitHub Pages."},
    {"title": "All 4 E2E shards passed", "time": "6m ago", "status": "info", "description": "Chromium suite verified chat, A2UI canvas, and docs routes."},
    {"title": "Fallback model triggered", "time": "22m ago", "status": "warning", "description": "Primary endpoint rate-limited; routed to secondary provider."}
  ]
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.timeline(
    [
        {"title": "Release v0.3.183 live", "time": "2m ago", "status": "success", "description": "Published to PyPI."},
        {"title": "All 4 E2E shards passed", "time": "6m ago", "status": "info"},
        {"title": "Fallback model triggered", "time": "22m ago", "status": "warning"},
    ],
    title="Recent Deployment Events",
)
```
</Tab>
<Tab title="YAML">
```yaml
- type: timeline
  title: "Recent Deployment Events"
  items:
    - title: "Release v0.3.183 live"
      time: "2m ago"
      status: "success"
      description: "Published to PyPI."
    - title: "All 4 E2E shards passed"
      time: "6m ago"
      status: "info"
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `items` | `list[dict]` | Events with `title`, optional `time`, `description`, and `status` (`default`, `info`, `success`, `warning`, `error`). |
| `title` | `str` | Optional heading above the timeline. |
