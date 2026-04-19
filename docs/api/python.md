# Python SDK API

Reference for `import praisonaiui as aiui`.

## Server Configuration

These functions configure the server. Call them at module level in your `app.py`, before the server starts.

### `aiui.set_style(style)`

Set the UI style.

| Parameter | Type | Values |
|-----------|------|--------|
| `style` | `str` | `"chat"`, `"dashboard"`, `"agents"`, `"playground"`, `"docs"`, `"custom"` |

```python
aiui.set_style("dashboard")
```

Priority: `set_style()` → CLI `--style` flag → auto-detection.

---

### `aiui.set_pages(page_ids)`

Whitelist which built-in sidebar pages to show (dashboard mode). Custom pages registered via `@aiui.page()` always appear.

```python
aiui.set_pages([
    "chat", "agents", "memory", "knowledge",
    "skills", "sessions", "usage", "config", "logs",
])
```

Use `aiui pages ids` to see all available page IDs.

---

### `aiui.set_branding(title, logo)`

Configure the sidebar branding (title text and logo emoji).

| Parameter | Type | Default |
|-----------|------|---------|
| `title` | `str` | `"PraisonAI"` |
| `logo` | `str` | `"🦞"` |

```python
aiui.set_branding(title="MyApp", logo="🚀")
```

Also configurable via `config.yaml`:
```yaml
site:
  title: MyApp
  logo: 🚀
```

---

### `aiui.set_datastore(store)`

Set the persistence backend for sessions and messages.

```python
# JSON file store (default)
aiui.set_datastore(aiui.JSONFileDataStore())

# In-memory (no persistence)
aiui.set_datastore(aiui.MemoryDataStore())
```

---

### `aiui.set_provider(provider)`

Set the AI provider for chat completions.

```python
aiui.set_provider(aiui.PraisonAIProvider())
```

---

### `aiui.register_agent(config)`

Register an AI agent for the dashboard. Agents appear in the sidebar and can be selected for chat.

```python
aiui.register_agent({
    "agent_id": "researcher",
    "name": "Researcher",
    "description": "Research assistant",
    "instructions": "You are a research assistant.",
    "model": "gpt-4o-mini",
    "icon": "🔬",
})
```

---

### `aiui.remove_page(page_id)`

Remove a page from the sidebar.

```python
aiui.remove_page("debug")
```

---

### `aiui.set_chat_mode(mode, *, position, size, resizable, minimized)`

Configure chat window display mode — full page, floating window, or sidebar panel.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | `str` | `"fullpage"` | `"fullpage"`, `"floating"`, or `"sidebar"` |
| `position` | `tuple[int, int]` | `(20, 20)` | (bottom, right) pixel offset for floating mode |
| `size` | `tuple[int, int]` | `(400, 500)` | (width, height) initial size for floating mode |
| `resizable` | `bool` | `True` | Allow resizing the floating window |
| `minimized` | `bool` | `False` | Start minimized (floating mode only) |

```python
import praisonaiui as aiui

# Full page chat (default)
aiui.set_chat_mode("fullpage")

# Floating chat window
aiui.set_chat_mode("floating", position=(20, 20), size=(420, 550))

# Sidebar panel
aiui.set_chat_mode("sidebar")
```

---

### `aiui.set_sidebar_config(*, collapsible, default_collapsed, width, min_width, max_width)`

Configure sidebar behavior and dimensions.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `collapsible` | `bool` | `True` | Allow sidebar to be collapsed |
| `default_collapsed` | `bool` | `False` | Start with sidebar collapsed |
| `width` | `int` | `260` | Default sidebar width in pixels |
| `min_width` | `int` | `200` | Minimum width when resizing |
| `max_width` | `int` | `360` | Maximum width when resizing |

```python
import praisonaiui as aiui

aiui.set_sidebar_config(collapsible=True, width=280)
aiui.set_sidebar_config(default_collapsed=True)  # Start collapsed
```

---

### `aiui.set_brand_color(color)`

Set the brand/primary accent color. Overrides the theme's default accent.

| Parameter | Type | Description |
|-----------|------|-------------|
| `color` | `str` | Hex color (e.g. `"#6366f1"`) or CSS color value |

```python
import praisonaiui as aiui

aiui.set_brand_color("#818cf8")  # Indigo-400
aiui.set_brand_color("#22c55e")  # Green-500
```

---

### `aiui.set_chat_features(*, history, streaming, file_upload, audio, reasoning, tools, multimedia, feedback)`

Configure which chat features are enabled in the UI.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `history` | `bool` | `True` | Show session history sidebar |
| `streaming` | `bool` | `True` | Enable streaming responses |
| `file_upload` | `bool` | `False` | Show file upload button |
| `audio` | `bool` | `False` | Show audio input button |
| `reasoning` | `bool` | `True` | Show reasoning/thinking steps |
| `tools` | `bool` | `True` | Show tool call displays |
| `multimedia` | `bool` | `True` | Enable multimedia rendering |
| `feedback` | `bool` | `False` | Show feedback buttons |

```python
import praisonaiui as aiui

# Minimal chat — no history sidebar, no file upload
aiui.set_chat_features(history=False, file_upload=False)

# Full-featured chat
aiui.set_chat_features(
    history=True,
    streaming=True,
    file_upload=True,
    audio=True,
    feedback=True,
)
```

---

### `aiui.set_dashboard(*, sidebar, page_header)`

Configure dashboard layout options.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sidebar` | `bool` | `True` | Show the left sidebar navigation |
| `page_header` | `bool` | `True` | Show the page title/description header |

```python
import praisonaiui as aiui

aiui.set_style("dashboard")
aiui.set_dashboard(sidebar=False)       # Chat-only dashboard, no sidebar
aiui.set_dashboard(page_header=False)   # Hide page titles
```

---

### `aiui.register_theme(name, variables)`

Register a custom theme preset. The theme becomes available in the theme picker UI and via `/api/theme`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `str` | Unique theme name (e.g. `"ocean"`, `"sunset"`) |
| `variables` | `dict[str, str]` | Dict with at least `{"accent": "#hexcolor"}` |

```python
import praisonaiui as aiui

# Register a custom theme
aiui.register_theme("ocean", {"accent": "#0077b6"})

# With explicit RGB (auto-derived if omitted)
aiui.register_theme("sunset", {
    "accent": "#ff6b35",
    "accentRgb": "255,107,53",
})

# Apply the custom theme
aiui.set_theme(preset="ocean")
```

See [CSS Architecture](../features/css-architecture.md) for all available CSS variables.

---

### `aiui.set_custom_js(path)`

Inject a local JavaScript file into the UI. Reads the file at `path` and
serves it at `/custom.js`. A `<script src="/custom.js">` tag is injected
into the host HTML **after** the plugin loader, so `window.aiui` and all
registry APIs (`registerView`, `registerComponent`) are ready when your
code runs.

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `str \| Path` | Local filesystem path to a `.js` file |

Raises `FileNotFoundError` if the path does not exist.

```python
import praisonaiui as aiui

aiui.set_custom_js("plugin.js")
```

Where `plugin.js` uses the client-side extension APIs:

```javascript
// plugin.js
window.aiui.registerComponent('timeline', function(comp) {
    const el = document.createElement('div');
    (comp.events || []).forEach(ev => {
        const row = document.createElement('div');
        row.textContent = `${ev.time} — ${ev.label}`;
        el.appendChild(row);
    });
    return el;
});
```

---

### `aiui.register_component_schema(component_type, schema)`

Register a JSON Schema contract for a component dict. Built-in schemas
are auto-derived from every `aiui.ui.*` builder at startup; user schemas
take priority and are merged on top.

| Parameter | Type | Description |
|-----------|------|-------------|
| `component_type` | `str` | Component type string (e.g. `"timeline"`) |
| `schema` | `dict` | JSON Schema dict (Draft 2020-12 compatible) |

```python
import praisonaiui as aiui

aiui.register_component_schema("timeline", {
    "type": "object",
    "required": ["type", "events"],
    "properties": {
        "type": {"const": "timeline"},
        "events": {"type": "array"},
    },
})
```

### `aiui.get_component_schemas()`

Returns the merged registry as a `dict[str, dict]`. Also available as a
JSON endpoint: `GET /api/components/schemas`.

```python
schemas = aiui.get_component_schemas()
print(sorted(schemas))   # ['accordion', 'alert', ..., 'timeline', ...]
```

---

### `aiui.prompt(question, *, options=None, timeout=300.0)`

Pause the agent and wait for the user to answer. Preferred entry point
for interactive agent flows — supersedes the legacy `AskUserMessage`
class.

| Parameter | Type | Description |
|-----------|------|-------------|
| `question` | `str` | Text shown to the user. |
| `options`  | `list[str] \| None` | Optional list of choices. When given, the user picks one; otherwise they type free text. |
| `timeout`  | `float` | Seconds to wait before giving up. Default 300 (5 min). |

Returns a `PromptResult` dataclass (`text`, `choice`, `message_id`).
The result is truthy when the user answered, falsy on timeout.

```python
import praisonaiui as aiui

@aiui.reply
async def on_message(msg: str):
    name = await aiui.prompt("What's your name?")
    if name:
        await aiui.say(f"Hi {name.text}!")

    pick = await aiui.prompt("Pick a colour", options=["red", "blue"])
    if pick:
        await aiui.say(f"You picked {pick.choice}")
```

---

### `aiui.error(content, *, details=None)`

Emit an error message to the chat. A thin helper around `Message` with
`metadata={"kind": "error"}` — keeps the public surface small.

```python
try:
    data = await fetch()
except Exception as exc:
    await aiui.error("Couldn't load data", details=str(exc))
```

---

### `aiui.configure(*, datastore=None, branding=None, theme=None, chat=None, custom_css=None, custom_js=None, style=None)`

One-stop configuration function. Every keyword is optional, so you only
set what you need. Replaces the dozen individual `set_*` setters for
most common cases (the `set_*` functions remain for advanced control).

| Parameter | Type | Description |
|-----------|------|-------------|
| `datastore` | `str` | Storage backend: `"memory"`, `"json"`, `"json:/path"`, `"sdk"`, `"sdk:/path"`. |
| `branding`  | `dict` | Forwarded to `set_branding(...)`. Keys: `title`, `logo`, `subtitle`. |
| `theme`     | `dict` | Forwarded to `set_theme(...)`. Keys: `preset`, `dark`/`dark_mode`, `radius`, `brand_color`. |
| `chat`      | `dict` | Forwarded to `set_chat_features(...)`. Keys: `feedback`, `mode`, plus any chat-feature flag. |
| `custom_css`| `str \| Path` | Path to a CSS file; same as `set_custom_css`. |
| `custom_js` | `str \| Path` | Path to a JS file; same as `set_custom_js`. |
| `style`     | `str` | UI style — `"chat"`, `"dashboard"`, etc. |

```python
import praisonaiui as aiui

aiui.configure(
    branding={"title": "My App", "logo": "🎨"},
    theme={"preset": "ocean", "dark": True, "radius": "md"},
    chat={"feedback": True, "mode": "single"},
    datastore="json",
    custom_css="styles.css",
    custom_js="plugin.js",
)
```

```python
import praisonaiui as aiui

# In-memory (default, volatile)
aiui.configure(datastore="memory")

# JSON files at ~/.praisonaiui/sessions/
aiui.configure(datastore="json")

# JSON files at custom path
aiui.configure(datastore="json:/tmp/my-sessions")

# SDK-backed store (unifies with praisonai-agents)
aiui.configure(datastore="sdk")
```

---

## Callback Decorators

### `@aiui.reply`

Handle incoming chat messages. This is the core callback.

```python
@aiui.reply
async def on_reply(message):
    await aiui.stream("Thinking...")
    # Process message.content
    await aiui.say("Here's the answer!")
```

The `message` object has:
- `message.content` — user's text
- `message.session_id` — session identifier
- `message.images` — attached images (if any)

---

### `@aiui.welcome`

Send a welcome message when a user connects.

```python
@aiui.welcome
async def on_welcome():
    await aiui.say("Welcome! How can I help you today?")
```

---

### `@aiui.goodbye`

Cleanup when a user disconnects.

```python
@aiui.goodbye
async def on_goodbye():
    await aiui.say("Goodbye! Your session has been saved.")
```

---

### `@aiui.starters`

Define conversation starters shown to new users.

```python
@aiui.starters
async def on_starters():
    return [
        {"label": "What can you do?", "message": "Tell me about your capabilities"},
        {"label": "Help me write", "message": "Help me draft an email"},
    ]
```

---

### `@aiui.profiles`

Define chat profiles (agent personas users can choose).

```python
@aiui.profiles
async def on_profiles():
    return [
        {"name": "Expert", "description": "Expert mode", "icon": "🎓"},
        {"name": "Creative", "description": "Creative writer", "icon": "✍️"},
    ]
```

---

### `@aiui.page(slug, title, icon, group, order)`

Register a custom dashboard page.

```python
@aiui.page("analytics", title="Analytics", icon="📊", group="Control", order=60)
async def analytics_page():
    return aiui.layout([
        aiui.card("Revenue", aiui.chart(data, "line")),
        aiui.card("Users", aiui.table(headers, rows)),
    ])
```

---

### `@aiui.on(event)`

Listen for server events.

```python
@aiui.on("session_created")
async def on_session(session):
    print(f"New session: {session.id}")
```

---

### `@aiui.login`

Handle authentication.

```python
@aiui.login
async def on_login(credentials):
    return {"user_id": "123", "name": "Admin"}
```

---

### `@aiui.settings`

Provide user settings.

```python
@aiui.settings
async def on_settings():
    return {"theme": "dark", "language": "en"}
```

---

### `@aiui.resume`

Resume interrupted sessions.

```python
@aiui.resume
async def on_resume(session_id):
    await aiui.say("Welcome back! Resuming your session.")
```

---

## Message Functions

Async functions for sending messages to the user. Call inside callback handlers.

| Function | Purpose |
|----------|---------|
| `await aiui.say(text)` | Send a complete message |
| `await aiui.stream(text)` | Stream a response progressively |
| `await aiui.stream_token(token)` | Stream token-by-token |
| `await aiui.think(text)` | Show a thinking indicator |
| `await aiui.ask(question)` | Ask user a question (returns answer) |
| `await aiui.image(url)` | Send an image |
| `await aiui.audio(url)` | Send audio |
| `await aiui.video(url)` | Send video |
| `await aiui.file(url)` | Send a file |
| `await aiui.action_buttons(buttons)` | Show action buttons |
| `await aiui.tool(name, data)` | Show tool call result |

---

## UI Components

Build custom page layouts with UI components.

```python
@aiui.page("dashboard", title="My Dashboard", icon="📊")
async def my_dashboard():
    return aiui.layout([
        aiui.columns([
            aiui.card("Metric A", value="42"),
            aiui.card("Metric B", value="98%", footer="+5% this week"),
        ]),
        aiui.card("Data", aiui.table(
            headers=["Name", "Value"],
            rows=[["Alpha", "100"], ["Beta", "200"]],
        )),
        aiui.card("Trend", aiui.chart(
            data=[10, 20, 30, 40],
            type="line",
        )),
    ])
```

| Component | Usage |
|-----------|-------|
| `aiui.layout(children)` | Root container for a page |
| `aiui.card(title, *, value, footer)` | Metric/stat card with title, value, and optional footer |
| `aiui.columns(children)` | Horizontal column layout |
| `aiui.chart(data, type)` | Chart (line, bar, pie) |
| `aiui.table(headers, rows)` | Data table |
| `aiui.text(content)` | Text block |

See [Component API Reference](components.md) for all 48 components.

---

## Data Classes

| Class | Purpose |
|-------|---------|
| `aiui.Message` | Incoming/outgoing message |
| `aiui.AskUserMessage` | User response to `ask()` |
| `aiui.Step` | Processing step indicator |
| `aiui.BaseDataStore` | Abstract datastore interface |
| `aiui.MemoryDataStore` | In-memory store |
| `aiui.JSONFileDataStore` | Persistent JSON file store |
| `aiui.BaseProvider` | Abstract AI provider interface |
| `aiui.PraisonAIProvider` | PraisonAI provider implementation |
| `aiui.RunEvent` | Streaming event |
| `aiui.RunEventType` | Event type enum |

---

## Feature Protocol

Register custom features that appear in the dashboard.

```python
from praisonaiui import BaseFeatureProtocol, register_feature

class MyFeature(BaseFeatureProtocol):
    name = "my_feature"
    # ... implement protocol methods

register_feature(MyFeature())
```

| Function | Purpose |
|----------|---------|
| `aiui.register_feature(feature)` | Register a feature |
| `aiui.get_features()` | List all features |
| `aiui.get_feature(name)` | Get a specific feature |
| `aiui.auto_register_defaults()` | Auto-register built-in features |
