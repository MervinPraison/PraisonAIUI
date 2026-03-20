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
            aiui.card("Metric A", aiui.text("42")),
            aiui.card("Metric B", aiui.text("98%")),
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
| `aiui.card(title, content)` | Card with title and body |
| `aiui.columns(children)` | Horizontal column layout |
| `aiui.chart(data, type)` | Chart (line, bar, pie) |
| `aiui.table(headers, rows)` | Data table |
| `aiui.text(content)` | Text block |

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
