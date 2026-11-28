# Media, Markdown & Content Components

> Render rich text, Markdown documents with auto TOC, images, responsive galleries, audio/video players and safe embeds.

Display rich prose, documentation runbooks, image galleries, and playable media inside any `@aiui.page` or declarative YAML page.

## Quick catalog

| Python builder | YAML `type` | What it renders |
|---|---|---|
| `aiui.text(content)` | `text` | Plain paragraph text |
| `aiui.markdown_text(content)` | `markdown_text` | Sanitized Markdown (tables, code blocks, links, lists) |
| `aiui.doc_viewer(content, *, title, toc=True)` | `doc_viewer` | Full Markdown document reader with automatic Table of Contents |
| `aiui.image_display(src, *, alt, caption, width)` | `image_display` | Single responsive image with optional caption |
| `aiui.gallery(items)` | `gallery` | Responsive thumbnail grid (`src`, `alt`, `caption`, optional click link) |
| `aiui.audio_player(src, *, autoplay=False, title)` | `audio_player` | Built-in HTML5 audio player |
| `aiui.video_player(src, *, autoplay=False, poster, title)` | `video_player` | Built-in HTML5 video player with poster image |
| `aiui.html(content)` / `aiui.html_embed(content)` | `html` / `html_embed` | Trusted HTML snippet container |

## Examples

### Python

```python
return aiui.layout([
    aiui.doc_viewer(
        "# Release Runbook\n\n## Pre-flight\nRun `aiui doctor` before deploying.",
        title="Operations Runbook",
        toc=True,
    ),
    aiui.gallery([
        {"src": "/static/hero-light.png", "alt": "Light mode", "caption": "Light theme"},
        {"src": "/static/hero-dark.png", "alt": "Dark mode", "caption": "Dark theme"},
    ]),
])
```

### YAML (Markdown file)

```yaml
pages:
  - id: runbook
    title: "Runbook"
    icon: "book-open"
    group: "Docs"
    markdown_file: "./runbook.md"
    toc: true
```

> **Tip:**
> In YAML pages, pointing `markdown_file:` to any local `.md` file renders it through `doc_viewer` automatically and reloads edits dynamically on the next page fetch without restarting the server.

## Related pages

- [Media, Downloads & Sandboxed HTML](https://ui.praison.ai/docs/components/media-players.md)
- [Doc Viewer](https://ui.praison.ai/docs/components/doc-viewer.md)
- [Gallery](https://ui.praison.ai/docs/components/gallery.md)
