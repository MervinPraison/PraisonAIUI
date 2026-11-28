# File Upload

> Drag-and-drop file uploader backed by the authenticated /api/chat/attachments endpoint with safe server-side resolution.

`file_upload()` renders an accessible drag-and-drop file uploader with size validation, removable file chips, and zero-dependency uploads (raw binary `X-Filename` over `POST /api/chat/attachments` — works even without `python-multipart`).

{
  "type": "file_upload",
  "label": "Upload dataset or document",
  "name": "doc",
  "accept": ".csv,.pdf,.txt,.md,.json",
  "max_size_mb": 10,
  "help_text": "CSV, PDF, Markdown, JSON, or plain text (max 10 MB)"
}

## Python (aiui.interface)

```python
import praisonaiui as aiui


def inspect_file(doc):
    # aiui.interface() resolves uploaded handles automatically via aiui.get_uploaded_file()
    if not doc:
        return "Upload a text or CSV file to inspect it."
    with open(doc["path"], "r", encoding="utf-8", errors="replace") as f:
        preview = f.read(1200)
    return [
        aiui.caption(f"{doc['filename']} · {doc['size']} bytes"),
        aiui.code_block(preview),
    ]


aiui.interface(
    inspect_file,
    inputs=[aiui.file_upload("Drop a file", name="doc", accept=".csv,.txt,.md,.json")],
    title="File Inspector",
)
```

## Python (@aiui.page)

```python
import praisonaiui as aiui


@aiui.page("upload-demo", title="Upload Demo", group="App")
async def upload_page():
    return aiui.layout([
        aiui.form("upload-demo", submit_label="Analyze", children=[
            aiui.file_upload("Upload CSV", name="doc", accept=".csv", max_size_mb=10),
        ]),
    ])


@aiui.register_page_action("upload-demo")
async def on_upload_action(data):
    meta = aiui.get_uploaded_file(data.get("doc"))
    if not meta:
        return {"error": "Please upload a valid file first."}
    return {"status": f"Received {meta['filename']} ({meta['size']} bytes)"}
```

## YAML (app.yaml)

```yaml
- type: file_upload
  label: Upload CSV
  name: doc
  accept: ".csv,.pdf"
  max_size_mb: 10
  help_text: "Drop CSV or PDF files here"
```

## Security & lifecycle

- `POST /api/chat/attachments` never returns internal server temp paths in HTTP responses and blocks active web types (`text/html`, `image/svg+xml`, `application/javascript`).
- Always resolve submitted handles on the server via `aiui.get_uploaded_file(handle_or_id)` (automatically applied in `aiui.interface()`) — malformed, expired, or forged path-traversal handles resolve to `None`.
- Uploaded temp files expire automatically by TTL (default `3600` s) and capacity limit (`500` entries).

## Props

| Parameter | Type | Default | Description |
|---|---|---|---|
| `label` | `str` | `"Upload file"` | Accessible field label shown above the dropzone. |
| `name` | `str` | `"files"` | Form field key submitted with the uploaded file handle(s). |
| `accept` | `str \| None` | `None` | Comma-separated file extensions or MIME filters (e.g. `".csv,.pdf"`). |
| `multiple` | `bool` | `False` | Allow uploading and submitting multiple files as a list of handles. |
| `max_size_mb` | `float` | `10` | Client-side file size cap in MB (enforced on the server too). |
| `help_text` | `str \| None` | `None` | Optional helper caption displayed inside the dropzone. |
| `auto_submit` | `bool` | `False` | Automatically submit the enclosing form as soon as upload finishes. |

## Related pages

- [Chat Attachments](https://ui.praison.ai/docs/features/attachments.md)
- [Workflows, Hooks & OpenAI-Compatible API](https://ui.praison.ai/docs/features/workflows-and-openai-api.md)
- [Gateway Chat](https://ui.praison.ai/docs/features/gateway-chat.md)
