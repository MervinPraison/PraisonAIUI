# UI Styles

The style decides which frontend serves your app. `aiui run` picks one from your
code when you do not name it.

## Available Styles

| Style | What it renders |
|-------|-----------------|
| `chat` | React chat interface: sessions, streaming, starters, profiles |
| `agents` | React multi-agent view with a tabbed agent/session sidebar |
| `playground` | React side-by-side input and output panels for prompt testing |
| `dashboard` | Vanilla-JS admin dashboard with built-in and custom pages |
| `docs` | React documentation site (sidebar, table of contents, search) |
| `custom` | React site built from your YAML templates and components, with an optional floating chat widget |
| `app` | The React app shell with selectable layouts (the `aiui run` default) |

`app` is what `aiui run` opens when nothing else picks a style; it starts in
the `chat` layout (no canvas) unless the app, its YAML or `AIUI_LAYOUT` picks
another. See [React app shell](react-shell.md) for what it contains and
[Layouts](layouts.md) for its layouts.

## Auto-Detection

```bash
aiui run app.py    # style is inferred from app.py
```

After loading `app.py`, the CLI looks at the callbacks and agents it registered
(`server.detect_style`):

| Your code registers | Detected style |
|---------------------|----------------|
| `@aiui.profiles` and at least one `aiui.register_agent()` | `agents` |
| one or more `@aiui.page(...)` callbacks | `dashboard` |
| anything else, such as `@aiui.reply` only | `app` (the React app shell, `chat` layout) |

### Example: detected as `agents`

```python
import praisonaiui as aiui

aiui.register_agent("Coder", {"name": "Coder", "instructions": "..."})

@aiui.profiles
async def get_profiles():
    return [
        {"name": "Coder", "icon": "💻", "default": True},
        {"name": "Writer", "icon": "✍️"},
    ]

@aiui.reply
async def on_message(message):
    await aiui.say(f"Echo: {message}")
```

```bash
aiui run app.py
# ℹ️ Auto-detected style: agents
```

## Setting the Style

### From the CLI

```bash
aiui run app.py --style chat         # the classic chat style
aiui run app.py --style agents
aiui run app.py --style playground
```

`--style` has no default value, so any style you name, `chat` included, wins over
`aiui.set_style()` and detection.

### From Python

```python
import praisonaiui as aiui

aiui.set_style("playground")  # wins over auto-detection

@aiui.reply
async def on_message(message):
    await aiui.say(f"Echo: {message}")
```

### From YAML

A YAML chat app (`aiui run chat.yaml`) reads `style:` and applies it through
`aiui.set_style()`:

```yaml
name: My App
instructions: You are a helpful assistant.
style: agents

profiles:
  - name: "General"
    icon: "🤖"
    default: true
  - name: "Coder"
    icon: "💻"
```

```bash
aiui run chat.yaml
```

### Environment

`AIUI_SHELL=app` turns the `dashboard` style into `app`; `AIUI_SHELL=legacy`
turns `app` back into `dashboard` (the kill switch). It has no effect on the
other styles.

## Priority Order

1. `style:` in a YAML chat app
2. CLI `--style`
3. `aiui.set_style()` in Python
4. Auto-detection (`agents` or `dashboard`)
5. Default: `app`

## Chat Positioning

`layout.mode` in a YAML site config places the React chat on the page instead of
filling it:

| `layout.mode` | Description |
|---------------|-------------|
| `fullscreen` | Full-page chat (default) |
| `sidebar` | Fixed right-side panel |
| `bottom-right` | Floating widget, bottom-right corner |
| `bottom-left` | Floating widget, bottom-left corner |
| `top-right` | Floating widget, top-right corner |
| `top-left` | Floating widget, top-left corner |

In the `docs` and `custom` styles, `chat.enabled: true` with one of the four
corner modes adds the floating chat widget on top of the site. In the
`dashboard` style the equivalent is
`aiui.set_chat_mode("fullpage" | "floating" | "sidebar")`.
