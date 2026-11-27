---
title: Doc Viewer
nav_title: Doc Viewer
description: Long-form Markdown document viewer with automatic heading extraction and sticky TOC.
---

# Doc Viewer

`doc_viewer()` renders long-form Markdown manuals, runbooks, or agent-generated reports alongside an automatically generated clickable table of contents.

<ComponentPreview title="Document Viewer with Table of Contents">
{
  "type": "markdown_text",
  "toc": true,
  "title": "Runbook: Deploying Agents",
  "content": "# Deploying Agents\n\n## Prerequisites\nInstall `aiui` and export your provider key.\n\n## Verification\nCheck `/health` and `/api/overview` after startup.\n\n## Rollback\nPin the previous wheel version in `requirements.txt`."
}
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.doc_viewer(
    "# Deploying Agents\n\n## Prerequisites\nInstall `aiui`.\n\n## Verification\nCheck `/health`.",
    title="Runbook: Deploying Agents",
    toc=True,
)
```
</Tab>
<Tab title="YAML">
```yaml
- type: markdown_text
  title: "Runbook: Deploying Agents"
  toc: true
  content: |
    # Deploying Agents
    ## Prerequisites
    Install `aiui`.
```
</Tab>
</Tabs>

## Props

| Parameter | Type | Description |
|---|---|---|
| `content` | `str` | Markdown document body. |
| `title` | `str` | Optional document header title. |
| `toc` | `bool` | Show automatic heading outline (default `True`). |
