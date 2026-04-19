# Message Elements

PraisonAIUI supports rich inline message elements for displaying images, PDFs, videos, audio, files, and code blocks within chat messages.

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

- **File elements**: Maximum 100MB per file
- **Code elements**: Maximum 1MB per code block
- **Images**: No size limit (browser-dependent)

## Accessibility Features

- **Images**: Alt text support, keyboard navigation for zoom
- **PDFs**: Proper ARIA labels and roles
- **Videos/Audio**: Native browser accessibility
- **Files**: Icon-based file type recognition
- **Code**: Copy button with keyboard support

## Low-Level API

For advanced use cases, you can use the low-level element API:

```python
from praisonaiui.schema.models import ImageElement

# Create typed element
element = ImageElement(
    url="https://example.com/image.png",
    alt="Description",
    display="inline"
)

# Add to message
msg.elements.append(element)
```

## Legacy Support

The new element system maintains backward compatibility with existing message properties:

- `message.images` (still supported)
- `message.files` (still supported)
- New `message.elements` takes precedence when both are present

This ensures existing code continues to work while providing a migration path to the new standardized element system.