---
title: Text, Caption & Markdown
nav_title: Text & Markdown
description: Body copy, muted captions, and sanitized Markdown content blocks with GFM support.
---

# Text, Caption & Markdown

Render plain text with `text()`, subtle metadata labels with `caption()`, and full GitHub-Flavored Markdown (sanitized with `rehype-sanitize`) with `markdown_text()`.

<ComponentPreview title="Text, Caption & Markdown">
[
  {"type": "text", "content": "PraisonAIUI blocks adapt automatically to light mode, dark mode, and custom theme presets."},
  {"type": "caption", "text": "Synced 12 seconds ago via /api/pages/overview"},
  {"type": "markdown_text", "content": "### Release Highlights\n- **Zero-code YAML** and Python `@aiui.page` parity\n- Interactive `A2UI` surfaces and live `ComponentPreview` blocks"}
]
</ComponentPreview>

<Tabs>
<Tab title="Python">
```python
import praisonaiui as aiui

aiui.text("PraisonAIUI blocks adapt automatically to light and dark themes.")
aiui.caption("Synced 12 seconds ago")
aiui.markdown_text("### Release Highlights\n- **Zero-code YAML** parity\n- Live previews")
```
</Tab>
<Tab title="YAML">
```yaml
- type: text
  content: "PraisonAIUI blocks adapt automatically to light and dark themes."
- type: caption
  text: "Synced 12 seconds ago"
- type: markdown_text
  content: |
    ### Release Highlights
    - **Zero-code YAML** parity
```
</Tab>
</Tabs>

## Props

| Component | Parameter | Description |
|---|---|---|
| `text` | `content` | Plain escaped text paragraph. |
| `caption` | `text` | Small muted secondary text. |
| `markdown_text` | `content`, `toc`, `title` | Sanitized Markdown renderer; set `toc=True` for an interactive table of contents. |
