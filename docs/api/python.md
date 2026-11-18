---
nav_title: Python API
---

# Python SDK API

Reference for `import praisonaiui as aiui`.

## Server Configuration

These functions configure the server. Call them at module level in your `app.py`, before the server starts.

### `aiui.set_style(style)`

Set the UI style.

| Parameter | Type | Values |
|-----------|------|--------|
| `style` | `str` | `"app"` (the React app shell), `"chat"` (the classic chat), `"dashboard"`, `"agents"`, `"playground"`, `"docs"`, `"custom"` |

```python
aiui.set_style("dashboard")
```

Priority under `aiui run`: CLI `--style`, then `set_style()`, then
auto-detection (a plain chat app gets `app`). See
[UI Styles](../features/styles.md).

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

Configure the sidebar branding (title text and logo).

| Parameter | Type | Default |
|-----------|------|---------|
| `title` | `str` | `"PraisonAI"` |
| `logo` | `str` | `""` (no logo: the PraisonAI brand glyph) |

`logo` is an image URL or path (`/static/logo.svg`, `https://…`, `data:image/…`)
or a short text mark. Left empty, every UI draws the PraisonAI glyph on the
accent tile.

```python
aiui.set_branding(title="MyApp", logo="/static/logo.svg")
```

Also configurable via `config.yaml`:
```yaml
site:
  title: MyApp
  logo: /static/logo.svg
```

---

### `aiui.set_datastore(store)`

Set the persistence backend for sessions and messages.

```python
# JSON files under ~/.praisonaiui (or AIUI_DATA_DIR)
aiui.set_datastore(aiui.JSONFileDataStore())

# In-memory (no persistence)
aiui.set_datastore(aiui.MemoryDataStore())
```

Without a call, the server uses the SDK store shared with PraisonAI Agents
(`SDKFileDataStore`, from `praisonaiui.datastore_sdk`), falling back to
`JSONFileDataStore`. `aiui run --datastore` sets the same thing from the
command line.

---

### `aiui.set_provider(provider)`

Set the AI provider for chat completions.

```python
aiui.set_provider(aiui.PraisonAIProvider())
```

---

### `aiui.register_agent(name, agent)`

Register an agent object (for example a PraisonAI Agents `Agent`) under a
name. Together with an `@aiui.profiles` callback, registered agents make
`aiui run` pick the `agents` style.

```python
from praisonaiagents import Agent

aiui.register_agent("researcher", Agent(name="Researcher", instructions="You research topics."))
```

Agents created in the dashboard's Agents page are a separate store
(`/api/agents/definitions`).

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

### `aiui.set_dashboard(*, sidebar, page_header, modules, plugin_dirs, plugins, groups)`

Configure dashboard layout options.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sidebar` | `bool` | `True` | Show the left sidebar navigation |
| `page_header` | `bool` | `True` | Show the page title/description header |
| `modules` | `list[str] \| None` | `None` | Optional dashboard JS modules (`jobs`, `auth`, `api`) |
| `plugin_dirs` | `list[str] \| None` | `None` | Extra directories to scan for dashboard plugins |
| `plugins` | `list[str] \| None` | `None` | Allowlist of dashboard plugin names. `None` = all discovered (bundled, `~/.praisonai/dashboard-plugins`, `plugin_dirs`); `[]` = none |
| `groups` | `dict \| None` | `None` | Sidebar group order and folding in the app shell (YAML `dashboard.groups`) |

```python
import praisonaiui as aiui

aiui.set_style("dashboard")
aiui.set_dashboard(sidebar=False)       # Chat-only dashboard, no sidebar
aiui.set_dashboard(page_header=False)   # Hide page titles
aiui.set_dashboard(plugins=[])          # No auto-discovered dashboard plugins
```

`plugins` filters both the sidebar pages (`/api/pages`) and the browser plugin
manifest (`/api/dashboard/plugins`), so disabled plugin scripts are never loaded.
It scopes navigation only — it is **not** an authorization boundary for API routes.

---

### `aiui.set_chat_preview(enabled, *, surface_id, width)`

Configure the **chat + canvas** split preview (`chat-canvas` page). The vanilla `chat` page is unchanged.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `enabled` | `bool` | `True` | Expose preview settings in `/ui-config.json` |
| `surface_id` | `str` | `"main"` | Default A2UI surface id for the preview panel |
| `width` | `str` | `"40%"` | CSS width of the preview column (e.g. `"38%"`, `"420px"`) |

```python
aiui.set_chat_preview(enabled=True, surface_id="main", width="38%")
aiui.set_pages(["chat-canvas", "chat", "canvas"])
```

See [A2UI canvas](../features/a2ui-canvas.md).

---

### `aiui.set_theme(preset="zinc", dark_mode=True, radius="md")`

Set the colour palette, colour mode and corner radius. Takes priority over
YAML `site.theme`.

| Parameter | Type | Values |
|-----------|------|--------|
| `preset` | `str` | `zinc`, `slate`, `stone`, `gray`, `neutral`, `red`, `orange`, `amber`, `yellow`, `lime`, `green`, `emerald`, `teal`, `cyan`, `sky`, `blue`, `indigo`, `violet`, `purple`, `fuchsia`, `pink`, `rose`, or a name from `register_theme()` |
| `dark_mode` | `bool \| None` | `True` dark, `False` light, `None` leaves it to YAML or the viewer and the OS |
| `radius` | `str` | `none`, `sm`, `md`, `lg`, `xl` |

```python
aiui.set_theme(preset="blue", dark_mode=None, radius="lg")
```

See [Theming](../features/theming.md).

---

### `aiui.set_custom_css(css)`

Add a CSS string to the page as an inline `<style>` tag.

```python
aiui.set_custom_css(":root { --db-accent: #22c55e; }")
```

---

### `aiui.set_layout(default=None, *, available=None, user_choice=None, primary=None, options=None)`

Choose the React app shell's layout (`style: app`). See
[Layouts](../features/layouts.md).

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

The answer comes back over the chat WebSocket (`ask_response`), so a
question needs the WebSocket transport; the HTTP fallback (`POST /run`) can
show it but not answer it. Time spent waiting for the answer does not count
against the `@reply` inactivity timeout (`AIUI_REPLY_IDLE_TIMEOUT`).
`aiui.ask` and `AskUserMessage` work the same way.

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

One call for the common setters. Every keyword is optional; each one is
forwarded to the matching `set_*` function, which you can still call directly.

| Parameter | Type | Description |
|-----------|------|-------------|
| `datastore` | `str` | Storage backend: `"memory"`, `"json"`, `"json:/path"`, `"sdk"`, `"sdk:/path"`. |
| `branding`  | `dict` | Forwarded to `set_branding(...)`. Keys: `title`, `logo` (any other key raises `TypeError`). |
| `theme`     | `dict` | Forwarded to `set_theme(...)`. Keys: `preset`, `dark`/`dark_mode`, `radius`; `brand_color` goes to `set_brand_color()`. |
| `chat`      | `dict` | `feedback` goes to `set_feedback_enabled()`, `mode` to `set_chat_mode()`, other keys to `set_chat_features()`. |
| `custom_css`| `str` | CSS text, passed to `set_custom_css()` unchanged. It is not read from a file: pass `Path("styles.css").read_text()` to use one. |
| `custom_js` | `str \| Path` | Path to a JS file; same as `set_custom_js`. |
| `style`     | `str` | UI style — `"chat"`, `"dashboard"`, etc. |

```python
import praisonaiui as aiui

from pathlib import Path

aiui.configure(
    branding={"title": "My App", "logo": "🎨"},
    theme={"preset": "blue", "dark": True, "radius": "md"},
    chat={"feedback": True, "mode": "floating"},
    datastore="json",
    custom_css=Path("styles.css").read_text(),
    custom_js="plugin.js",
)
```

```python
import praisonaiui as aiui

# In-memory (volatile)
aiui.configure(datastore="memory")

# JSON files at ~/.praisonaiui/sessions/
aiui.configure(datastore="json")

# JSON files at custom path
aiui.configure(datastore="json:/tmp/my-sessions")

# SDK-backed store shared with PraisonAI Agents (the default)
aiui.configure(datastore="sdk")
```

---

## Callback Decorators

### `@aiui.reply`

Handle incoming chat messages. This is the core callback.

```python
@aiui.reply
async def on_reply(message):
    await aiui.think("Thinking...")
    await aiui.say(f"You said: {message.text}")
```

Annotate the parameter as `str` (`async def on_reply(message: str)`) to get
the text only. Otherwise the callback gets a `MessageContext` with:

- `message.text` (alias `message.content`): the user's text
- `message.session_id`: the session id
- `message.agent_name`: the selected agent, if any
- `message.attachments`: the files sent with the message,
  `[{id, name, content_type, path}]` (see [Attachments](../features/attachments.md))

How a reply ends:

- If the callback raises, the run ends with one `run_error` frame carrying the
  exception text. The chat shows the error under whatever was streamed, the
  reply is saved with `status: "error"` (so it is still there after a
  reload), the run ledger counts it as failed, and the traceback is logged.
- Stop (`chat_abort`, `POST /api/chat/abort`, `POST /cancel`) cancels the
  callback task: the callback gets `asyncio.CancelledError` at its next
  `await`, so an LLM call or tool it is waiting on stops too.
- A callback that sends nothing (no token, message, step or tool event) for
  `AIUI_REPLY_IDLE_TIMEOUT` seconds (default 600) is cancelled and the run
  fails with a timeout. Set `AIUI_REPLY_IDLE_TIMEOUT=0` for no limit.

---

### `@aiui.welcome`

The greeting on a new, empty chat.

```python
@aiui.welcome
async def on_welcome():
    await aiui.say("Welcome! How can I help you today?")
```

The chat runs it through `POST /welcome` once per page load and shows what
it says (`aiui.say`, or streamed tokens) as plain text on the empty thread:
in the app shell's chat and every layout, the `chat` style and the
dashboard's chat. In a layout's new-chat hero (the site's mark and name)
the greeting takes the place of the generic "Ask anything…" line, with the
starters below it. It is not saved to the conversation. A chat YAML's
`welcome:` key registers one for you.

---

### `@aiui.goodbye`

Registers a session-end handler. The server does not call it yet.

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

### `@aiui.page(id, *, title, icon="📄", group="Custom", description="", order=100)`

Register a custom dashboard page. The callback's return value is the page
data (`GET /api/pages/<id>/data`); return UI components to render them. An app
with pages opens in the `dashboard` style.

```python
@aiui.page("analytics", title="Analytics", icon="📊", group="Control", order=60)
async def analytics_page():
    return aiui.layout([
        aiui.card("Revenue", value="$12,345"),
        aiui.chart("Signups", data=[{"name": "Mon", "value": 4}, {"name": "Tue", "value": 7}], chart_type="line"),
    ])
```

`aiui.register_page(id, *, title, ...)` registers a page without a decorator.

---

### `@aiui.on(event)`

Register a handler for a named event. The server dispatches `feedback`
(a thumbs up or down on a message) to it:

```python
@aiui.on("feedback")
async def on_feedback(event):
    print(event["session_id"], event["message_id"], event["value"], event["comment"])
```

---

### `@aiui.login`, `@aiui.settings`, `@aiui.resume`

These decorators register a handler, but the server does not call them yet,
so do not rely on them. Sign-in is configured with YAML `auth:` or
`create_app(require_auth=...)`; see [Deployment](../features/deployment.md).

---

### `@aiui.surface_action(surface_id)`

Handle user actions from an A2UI surface (button clicks, form submits).

```python
@aiui.surface_action("main")
async def on_surface_action(action: dict):
    # action includes component_id, action name, data, session_id
    return {"status": "ok"}
```

---

## Message Functions

Async functions for sending messages to the user. Call inside callback handlers.

| Function | Purpose |
|----------|---------|
| `await aiui.say(content)` | Send a complete message |
| `await aiui.stream_token(token)` | Append a token to the streaming reply |
| `await aiui.stream(token)` | Same as `stream_token` |
| `await aiui.think(step)` | Show a reasoning step |
| `await aiui.ask(question, options=None, timeout=300.0)` | Ask the user and wait; returns the answer text |
| `await aiui.image(url, alt="")` | Send an image |
| `await aiui.audio(url)` | Send audio |
| `await aiui.video(url)` | Send video |
| `await aiui.file(url, name="")` | Send a file |
| `await aiui.action_buttons(buttons)` | Show buttons; handle clicks with `@aiui.button(name)` |
| `await aiui.tool(name, args=None, result=None)` | Show a tool call and its result |

---

## UI Components

Build custom page layouts with UI components.

```python
@aiui.page("my-dashboard", title="My Dashboard", icon="📊")
async def my_dashboard():
    return aiui.layout([
        aiui.columns([
            aiui.card("Metric A", value="42"),
            aiui.card("Metric B", value="98%", footer="+5% this week"),
        ]),
        aiui.table(headers=["Name", "Value"], rows=[["Alpha", 100], ["Beta", 200]]),
        aiui.chart("Trend", data=[{"name": "Q1", "value": 10}, {"name": "Q2", "value": 30}], chart_type="line"),
    ])
```

| Component | Usage |
|-----------|-------|
| `aiui.layout(children)` | Root container for a page |
| `aiui.card(title, *, value=None, footer=None)` | Metric card |
| `aiui.columns(children)` | Horizontal column layout |
| `aiui.chart(title, *, data=None, chart_type="bar")` | Chart; `data` is a list of dicts |
| `aiui.table(*, headers, rows, row_ids=None, actions=None)` | Data table |
| `aiui.text(content)` | Text block |

See the [Component API Reference](components.md) for the other builders
(metrics, alerts, tabs, forms and more).

---

## Data Classes

| Class | Purpose |
|-------|---------|
| `aiui.Message` | Outgoing message with elements and actions |
| `aiui.AskUserMessage` | Ask the user for text (older form of `aiui.prompt`) |
| `aiui.Step` | Processing step indicator |
| `aiui.BaseDataStore` | Abstract datastore interface |
| `aiui.MemoryDataStore` | In-memory store |
| `aiui.JSONFileDataStore` | Persistent JSON file store |
| `aiui.SQLAlchemyDataStore` | SQL store (`pip install "aiui[sql]"`) |
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
