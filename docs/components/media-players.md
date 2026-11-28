# Media, Downloads & Sandboxed HTML

> Images, audio/video players, file download buttons, and isolated sandboxed HTML embeds.

Render rich media using `image_display()`, `audio_player()`, and `video_player()`, offer artifacts with `file_download()`, and safely embed custom HTML/SVG widgets in a sandboxed iframe with `html()` (alias `html_embed()`).

[
  {"type": "image_display", "src": "/icon.svg", "alt": "PraisonAIUI Mark", "caption": "PraisonAIUI vector mark", "width": "64px"},
  {"type": "file_download", "label": "Download JSON Schema", "href": "/aiui.schema.json", "filename": "aiui.schema.json", "variant": "outline"},
  {"type": "html", "title": "Sandboxed HTML Widget", "height": 58, "content": "<div style=\"padding:10px 14px;font-family:system-ui,sans-serif;font-size:13px;border-radius:8px;background:#eef2ff;color:#312e81\">Rendered inside a sandboxed iframe (zero parent DOM access)</div>"}
]

## Python

```python
import praisonaiui as aiui

aiui.image_display("/icon.svg", alt="PraisonAIUI", caption="Vector mark", width="64px")
aiui.audio_player("/media/reply.mp3", title="Voice Reply")
aiui.video_player("/media/demo.mp4", poster="/media/poster.png", title="Walkthrough")
aiui.file_download("Download Report", href="/api/reports/latest.csv", filename="report.csv")
aiui.html("<div>Sandboxed widget</div>", height=80, title="Custom Widget")
```

## YAML

```yaml
- type: image_display
  src: "/icon.svg"
  alt: "PraisonAIUI"
  width: "64px"
- type: file_download
  label: "Download Schema"
  href: "/aiui.schema.json"
  filename: "aiui.schema.json"
- type: html
  title: "Custom Widget"
  height: 80
  content: "<div>Sandboxed widget</div>"
```

## Props

| Component | Parameter | Description |
|---|---|---|
| `image_display` | `src`, `alt`, `caption`, `width` | Responsive image with optional caption and max width. |
| `audio_player` / `video_player` | `src`, `title`, `autoplay`, `poster` | Native browser media players with safe URL validation. |
| `file_download` | `label`, `href`, `filename`, `variant` | Styled download link/button with `download` attribute. |
| `html` / `html_embed` | `content`, `height`, `csp`, `trusted`, `title` | Isolated `srcdoc` iframe sandbox preventing XSS against the host app. |

## Related pages

- [Media, Markdown & Content Components](https://ui.praison.ai/docs/components/media-and-content.md)
- [Message Elements](https://ui.praison.ai/docs/features/message-elements.md)
- [Gallery](https://ui.praison.ai/docs/components/gallery.md)
