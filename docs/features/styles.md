# UI Styles

PraisonAIUI supports 6 distinct UI styles that control how your application looks and behaves. Styles are **auto-detected** from your code — you usually don't need to set them manually.

## Available Styles

| Style | Layout | Description |
|-------|--------|-------------|
| `chat` | `ChatLayout` | Conversational AI interface with sessions, streaming, profiles |
| `agents` | `AgentUILayout` | Multi-agent playground with tabbed agent/session sidebar |
| `playground` | `PlaygroundLayout` | Side-by-side input/output panels for prompt testing |
| `dashboard` | `DashboardLayout` | Admin panel with custom pages |
| `docs` | `ThreeColumnLayout` | Documentation site with sidebar + TOC |
| `custom` | User-defined | Full control over layout |

## Auto-Detection

PraisonAIUI automatically detects the best style from your Python code — no flags needed:

```bash
aiui run app.py    # style is inferred automatically
```

### How It Works

After loading your `app.py`, the CLI inspects which callbacks and agents you registered:

| Your Code Uses | Detected Style |
|---------------|----------------|
| `@profiles` + `register_agent()` | `agents` |
| `@page` decorators | `dashboard` |
| `@reply` only | `chat` |

### Example: Auto-Detected as `agents`

```python
import praisonaiui as aiui

# These two signals trigger auto-detection of "agents" style
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
# Output: ℹ️ Auto-detected style: agents
```

## Explicit Style Setting

### From the CLI

Override auto-detection with `--style`:

```bash
aiui run app.py --style chat          # force chat layout
aiui run app.py --style agents        # force agents layout
aiui run app.py --style playground    # force playground layout
```

### From Python Code

Use `aiui.set_style()` for styles that can't be auto-detected (e.g., `playground`):

```python
import praisonaiui as aiui

aiui.set_style("playground")  # takes priority over auto-detection

@aiui.reply
async def on_message(message):
    await aiui.say(f"Echo: {message}")
```

## Priority Order

When multiple sources specify a style, this priority chain applies:

1. **CLI `--style`** flag (highest — always wins)
2. **`aiui.set_style()`** in Python code
3. **Auto-detection** from registered callbacks/agents
4. **Default:** `chat`

## Chat Layout Modes

The `chat` style supports additional layout modes for embedding:

| Mode | Description |
|------|-------------|
| `fullscreen` | Full-page chat (default) |
| `sidebar` | Fixed right-side panel |
| `bottom-right` | Floating widget (bottom-right corner) |
| `bottom-left` | Floating widget (bottom-left) |
| `top-right` | Floating widget (top-right) |
| `top-left` | Floating widget (top-left) |

## YAML Configuration

For YAML-based apps, set the style in your config:

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
aiui run chat.yaml    # reads style from YAML
```
