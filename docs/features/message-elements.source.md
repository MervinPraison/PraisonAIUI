# Message Elements

A message can carry elements: images, PDFs, videos, audio, files and code
blocks shown with the message text. Each element is a dict with a `type`, the
fields below, and an optional `name` and `display`.

## Sending elements

These reach the chat as `message_element` events:

```python
import praisonaiui as aiui
from praisonaiui import Message

@aiui.reply
async def on_message(message):
    # One media item per call
    await aiui.image("https://example.com/chart.png", alt="Monthly sales")
    await aiui.file("https://example.com/data.csv", name="Data Export")

    # Or elements as dicts on a Message
    msg = Message("Check out this chart:")
    msg.elements = [
        {"type": "image", "url": "https://example.com/chart.png", "name": "Sales Chart"},
    ]
    await msg.send()
```

`aiui.audio(url)` and `aiui.video(url)` work the same way.

`msg.add_image()`, `add_pdf()`, `add_video()`, `add_audio()`, `add_file()`
and `add_code()` validate their arguments and append typed elements
(`ImageElement` and the others in `praisonaiui.schema.models`); they reach the
chat like dicts. So does any object with `model_dump()` or `to_dict()`.

## Several messages in one reply

Each `aiui.Message(...).send()` and each `aiui.say(...)` is its own message:
the chat shows it at once, as its own block under the same answer, with its
author when it is not the agent, and its elements and actions under it. A
reload shows the same blocks.

```python
@aiui.reply
async def on_message(message):
    await aiui.Message(content="Looking that up...").send()
    chart = aiui.Message(content="Here is the chart:", author="Analyst")
    chart.add_image(url="https://example.com/chart.png", alt="Sales")
    await chart.send()

    answer = aiui.Message(content="")
    for token in ["The ", "total ", "is 42."]:
        await answer.stream_token(token)
    await answer.send()  # finalizes: the text is not repeated
```

Copy, feedback and Regenerate act on the whole answer. The saved reply keeps
`content` (the messages joined by a blank line) and `segments`
(`[{id, text, author?}]`); elements carry the `message_id` of their message.
`msg.update()` and `msg.remove()` change only that message while the reply
runs.

On the wire every piece of reply text names its message: `run_content`
carries `message_id` with a `token` (appended) or a whole `content` (sets that
message's text), plus `author` when set. `message_element` and
`message_actions` carry the same `message_id`; `message_update`,
`message_remove` and `action_remove` edit a message already shown.

The sections below list each element's fields.

## Element Types

### 1. Image Elements

Display images with thumbnail and click-to-zoom functionality.

```python
from praisonaiui import Message

msg = Message("Check out this chart:")
msg.add_image(
    url="https://example.com/chart.png",
    name="Sales Chart",
    alt="Monthly sales chart showing growth",
    display="inline"  # or "side", "page"
)
await msg.send()
```

**Properties:**
- `url` (required): Image URL
- `name` (optional): Display name
- `alt` (optional): Alt text for accessibility
- `display` (optional): Display mode - "inline" (default), "side", "page"
- `width` (optional): Fixed width in pixels
- `height` (optional): Fixed height in pixels

### 2. PDF Elements

Display PDF documents with inline viewer or link to open in new tab.

```python
msg.add_pdf(
    url="https://example.com/report.pdf",
    name="Quarterly Report",
    display="inline"  # Shows PDF viewer inline
)
```

**Properties:**
- `url` (required): PDF URL
- `name` (optional): Display name
- `display` (optional):
  - `"inline"`: Embedded PDF viewer (600px height)
  - `"side"`: Smaller embedded viewer (400px height)
  - `"page"`: Link to open in new tab

### 3. Video Elements

Display videos with native HTML5 video player.

```python
msg.add_video(
    url="https://example.com/demo.mp4",
    name="Product Demo",
    controls=True,  # Show video controls
    autoplay=False  # Don't autoplay
)
```

**Properties:**
- `url` (required): Video URL
- `name` (optional): Display name
- `controls` (optional): Show video controls (default: True)
- `autoplay` (optional): Auto-play video (default: False)
- `loop` (optional): Loop video (default: False)

### 4. Audio Elements

Display audio with native HTML5 audio player.

```python
msg.add_audio(
    url="https://example.com/clip.mp3",
    name="Audio Clip",
    controls=True
)
```

**Properties:**
- `url` (required): Audio URL
- `name` (optional): Display name
- `controls` (optional): Show audio controls (default: True)
- `autoplay` (optional): Auto-play audio (default: False)
- `loop` (optional): Loop audio (default: False)

### 5. File Elements

Display downloadable files with file type icons and size information.

```python
msg.add_file(
    url="https://example.com/data.csv",
    name="Data Export",
    size=1024000,  # Size in bytes
    mime_type="text/csv"
)
```

**Properties:**
- `url` (required): File download URL
- `name` (optional): Display name
- `size` (optional): File size in bytes
- `mime_type` (optional): MIME type for file type detection

### 6. Code Elements

Display syntax-highlighted code blocks with copy functionality.

```python
msg.add_code(
    content='print("Hello, World!")',
    language="python",
    name="Hello World Example"
)
```

**Properties:**
- `content` (required): Code content
- `language` (optional): Programming language for syntax highlighting
- `name` (optional): Display name

## Display Modes

All elements support three display modes:

- **`inline`** (default): Full width, normal display
- **`side`**: Smaller size, suitable for sidebars
- **`page`**: Full page width, maximum size

## Size Limits

`add_file()` raises `ValueError` when `size` is over 100 MB and `add_code()`
when `content` is over 1 MB. Dict elements are not checked.

## Typed models

`praisonaiui.schema.models` has a model per type (`ImageElement`, `PdfElement`,
`VideoElement`, `AudioElement`, `FileElement`, `CodeElement`) that validates the
fields above:

```python
from praisonaiui.schema.models import ImageElement

element = ImageElement(url="https://example.com/image.png", alt="Description")
msg.elements.append(element.model_dump(exclude_none=True))
```

## Agent-generated images (streaming)

When an agent or tool **creates** an image during a chat run, the UI receives `message_element` events over WebSocket/SSE and renders them inline. This uses the same element dict shape as above but is driven by the [RunEvent protocol](../concepts/providers.md), not only `Message.send()`.

See **[Image Preview in Chat](image-preview-chat.md)** for the full architecture: detection (`media_utils`), provider bridge, persistence, and swappable backends.