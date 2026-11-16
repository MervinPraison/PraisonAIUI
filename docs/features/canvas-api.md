# Canvas from Python

The [Chat and Canvas](layouts/chat-canvas.md) layout shows the tables, code and
files a chat makes on a canvas beside it, with every version. Without help the
canvas finds them in the reply text: a fenced code block or a markdown table
becomes an artifact, and a later block with the same file name or table header
is its next version. That depends on the model repeating the name.

`aiui.canvas` writes the canvas by name instead. The same name again is the
next version, authored by the agent of that reply, whatever the reply text
says.

## From app code

```python
import praisonaiui as aiui

TABLE = """| Algorithm | Average | Worst |
|---|---|---|
| Quicksort | O(n log n) | O(n^2) |
| Mergesort | O(n log n) | O(n log n) |"""


@aiui.reply
async def on_message(msg):
    aiui.canvas.write("sorting", TABLE, kind="table", title="Sorting algorithms")  # v1
    await aiui.say("The comparison is in the canvas.")
```

| Call | What it does |
|---|---|
| `aiui.canvas.write(key, content=None, *, kind=None, title=None, language=None, url=None, mime_type=None, session_id=None)` | Shows the artifact in the chat run in progress and stores it as the key's next version. Returns the stored version (`version`, `title`, …). The same content as the latest agent version adds no version. |
| `aiui.canvas.update(key, content, **fields)` | `write` that keeps the kind, title and language of the latest version. |
| `aiui.canvas.open(key)` | Shows an existing artifact in the canvas. `False` outside a run. |
| `aiui.canvas.read(key, *, version=None)` | The latest version (or that version) with its content, or `None`. The latest may be the user's own edit (`edited: True`). |
| `aiui.canvas.artifacts()` | The chat's artifacts, latest version of each, without content. |
| `aiui.canvas.artifact_element(key, content, …)` | The element a write sends, for a provider that yields events itself: `yield BaseProvider.message_element_event(aiui.canvas.artifact_element(...))`. |

`kind` is `code`, `table`, `markdown`, `image`, `pdf`, `video` or `file`.
Left out, it is `table` for content that starts with a markdown table, `code`
with a `language` or a code file name as the key (`app.py`), and `markdown`
otherwise; a `url` takes its kind from `mime_type`. A table's content is a
markdown table (a header row, then a `|---|` row). Bad input raises
`aiui.canvas.CanvasError` (a `ValueError`).

The functions are plain, not `async`, and safe from any thread: a tool running
in an agent's worker thread calls them as they are. They act on the run in
progress: the WebSocket chat binds the run's channel around the provider, and
the provider's tasks, the `@aiui.reply` callback and the agent's tool threads
inherit it. Outside a run, pass `session_id=` to read or to store without
showing.

## The protocol

A write is one `message_element` frame whose element is

```json
{"type": "artifact", "key": "sorting", "kind": "table", "title": "Sorting algorithms",
 "content": "| Algorithm | … |", "action": "upsert"}
```

with `language` for code and `url` / `mimeType` for media, and an open is
`{"type": "artifact", "key": "sorting", "action": "open"}`. The element is saved
with the reply, so a reload derives the same versions. The browser's artifact
rules (`layout-features/artifacts/derive.ts`) take `key` as the artifact's
identity. Frames are sent in the order written, before the provider's next
event.

While the artifacts feature (`builtin.artifacts`) is on, a write is also stored
on the server at once, so `read` sees it before the reply ends, and sees the
versions the user edits in the canvas. With the feature off nothing is stored,
`read` returns `None` and URL artifacts are refused.

Limits are the artifacts feature's: a key of at most 300 characters, text
content of at most 512 KB. Content is never rendered as HTML: markdown goes
through the chat's sanitised renderer, code and tables are shown as text.

The default `dashboard` style ignores `artifact` elements (it shows only
elements with a URL as links).
