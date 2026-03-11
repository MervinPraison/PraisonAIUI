# PraisonAI 🦞

[![Python Tests](https://github.com/MervinPraison/PraisonAIUI/actions/workflows/ci.yml/badge.svg)](https://github.com/MervinPraison/PraisonAIUI/actions)
[![PyPI version](https://badge.fury.io/py/aiui.svg)](https://badge.fury.io/py/aiui)

> **AI Dashboard & Multi-Agent Platform** — deploy agents with one Python file

PraisonAIUI gives you a full-featured AI dashboard with multi-agent chat, memory, skills, sessions, and 19 admin pages — all from a single `app.py`. It also supports YAML-driven chat bots and static documentation sites.

## Quick Start

### 1. Install

```bash
pip install aiui
```

### 2. Create `app.py`

```python
import praisonaiui as aiui

aiui.set_style("dashboard")

@aiui.reply
async def on_reply(message):
    return f"You said: {message.content}"
```

### 3. Run

```bash
aiui run app.py
```

Open **http://localhost:8000** — your AI dashboard is live.

## YAML Chat Mode

No Python needed — define your agent in YAML:

```yaml
# chat.yaml
name: My Assistant
instructions: You are a helpful assistant.
model: gpt-4o-mini
welcome: "Hi! How can I help?"
starters:
  - label: "What can you do?"
    message: "Tell me about your capabilities"
profiles:
  - name: Expert
    description: Expert mode
    icon: 🎓
tools:
  - web_search
  - calculate
features: true
datastore: json
```

```bash
aiui run chat.yaml
```

## Documentation Mode

Generate a static documentation site from Markdown:

```bash
aiui init
aiui build
aiui serve
```

## UI Styles

Six distinct UI styles, selectable via `--style` or `aiui.set_style()`:

| Style | Flag | Description | Best For |
|-------|------|-------------|----------|
| **Dashboard** | `--style dashboard` | Multi-page admin panel with sidebar | Agent management, admin dashboards |
| **Chat** | `--style chat` | Fullscreen/sidebar/floating chat | Conversational AI, customer support |
| **Agents** | `--style agents` | Tabbed multi-agent playground | Agent experimentation |
| **Playground** | `--style playground` | Input/output side-by-side panels | Prompt testing, comparison |
| **Docs** | `--style docs` | Three-column documentation layout | Documentation sites, knowledge bases |
| **Custom** | `--style custom` | User-defined layout | Full control |

```bash
aiui run app.py --style dashboard
aiui run app.py --style chat
aiui run chat.yaml --style agents
```

## Python SDK API

Write `app.py` using `import praisonaiui as aiui`:

### Configuration

| Function | Purpose | Example |
|----------|---------|---------|
| `aiui.set_style(style)` | Set UI style | `aiui.set_style("dashboard")` |
| `aiui.set_pages(ids)` | Whitelist sidebar pages | `aiui.set_pages(["chat", "agents", "memory"])` |
| `aiui.set_branding(title, logo)` | Configure branding | `aiui.set_branding("MyApp", "🚀")` |
| `aiui.set_datastore(store)` | Set persistence backend | `aiui.set_datastore(aiui.JSONFileDataStore())` |
| `aiui.set_provider(provider)` | Set AI provider | `aiui.set_provider(aiui.get_provider())` |
| `aiui.register_agent(config)` | Register an agent | `aiui.register_agent({"agent_id": "bot", ...})` |
| `aiui.remove_page(id)` | Remove a page | `aiui.remove_page("debug")` |

### Callback Decorators

| Decorator | Purpose |
|-----------|---------|
| `@aiui.reply` | Handle chat messages |
| `@aiui.welcome` | Welcome message on connect |
| `@aiui.goodbye` | Cleanup on disconnect |
| `@aiui.starters` | Suggest conversation starters |
| `@aiui.profiles` | Define chat profiles |
| `@aiui.page(slug, ...)` | Register a custom dashboard page |
| `@aiui.on(event)` | Listen for server events |
| `@aiui.login` | Handle authentication |
| `@aiui.settings` | User settings handler |
| `@aiui.resume` | Resume interrupted sessions |

### Message Functions

| Function | Purpose |
|----------|---------|
| `await aiui.say(text)` | Send a message |
| `await aiui.stream(text)` | Stream a response |
| `await aiui.stream_token(token)` | Stream token-by-token |
| `await aiui.ask(question)` | Ask user a question |
| `await aiui.image(url)` | Send an image |
| `await aiui.audio(url)` | Send audio |
| `await aiui.action_buttons(buttons)` | Show action buttons |

### UI Components

| Function | Purpose |
|----------|---------|
| `aiui.layout(children)` | Page layout container |
| `aiui.card(title, content)` | Card component |
| `aiui.chart(data, type)` | Chart (bar, line, pie) |
| `aiui.table(headers, rows)` | Data table |
| `aiui.columns(cols)` | Multi-column layout |
| `aiui.text(content)` | Text block |

## Full `app.py` Example

```python
"""Dashboard with three agents and a custom page."""
import os
import praisonaiui as aiui

# ── Style & pages ─────────────────────────────────────────────
aiui.set_style("dashboard")
aiui.set_pages([
    "chat", "agents", "memory", "knowledge",
    "skills", "sessions", "usage", "config", "logs",
])

# ── Branding ──────────────────────────────────────────────────
aiui.set_branding(title="PraisonAI", logo="🦞")

# ── Agents ────────────────────────────────────────────────────
aiui.register_agent({
    "agent_id": "researcher",
    "name": "Researcher",
    "description": "Finds and summarizes information",
    "instructions": "You are a research assistant.",
    "model": os.getenv("PRAISONAI_MODEL", "gpt-4o-mini"),
    "icon": "🔬",
})

aiui.register_agent({
    "agent_id": "coder",
    "name": "Coder",
    "description": "Writes clean, well-commented code",
    "instructions": "You are a coding assistant.",
    "model": os.getenv("PRAISONAI_MODEL", "gpt-4o-mini"),
    "icon": "💻",
})

# ── Custom page ───────────────────────────────────────────────
@aiui.page("explorer", title="Explorer", icon="🔬", group="Control", order=55)
async def explorer_page():
    return aiui.layout([aiui.text("Custom page content here.")])
```

```bash
aiui run app.py
```

## Dashboard Pages

All built-in pages available for `set_pages()`:

| ID | Icon | Group | Description |
|----|------|-------|-------------|
| `chat` | 💬 | Agent | AI agent chat |
| `channels` | 📡 | Agent | Messaging platform connections |
| `agents` | 🤖 | Agent | Configured AI agents |
| `skills` | ⚡ | Agent | Agent skills & plugins |
| `memory` | 🧠 | Agent | Agent memory & knowledge |
| `knowledge` | 📚 | Agent | Knowledge base & RAG |
| `guardrails` | 🛡️ | Agent | Input/output safety guardrails |
| `overview` | 📊 | Control | System health and statistics |
| `sessions` | 📋 | Control | Conversation history |
| `usage` | 📈 | Control | Token usage & metrics |
| `cron` | ⏰ | Agent | Scheduled jobs |
| `jobs` | 📋 | Control | Async agent jobs |
| `approvals` | ✅ | Control | Execution approval queue |
| `nodes` | 🖥️ | Control | Execution nodes & presence |
| `eval` | 📊 | Control | Agent evaluation & accuracy |
| `api` | 🔌 | Control | OpenAI-compatible API endpoints |
| `config` | ⚙️ | Settings | Server configuration |
| `auth` | 🔐 | Settings | Authentication settings |
| `logs` | 📜 | Settings | Server logs and events |
| `debug` | 🐛 | Settings | Debug information |
| `telemetry` | 📈 | Settings | Telemetry data |
| `traces` | 🔍 | Settings | Distributed traces |
| `security` | 🔒 | Settings | Security settings |
| `inspector` | 🔍 | Control | API endpoint debugger (footer) |

## CLI Commands

### Core Commands

```bash
aiui init [--template docs|minimal|marketing] [--frontend]  # Create project
aiui validate [--config FILE] [--strict]                     # Validate config
aiui build [--config FILE] [--output DIR] [--minify]         # Build static site
aiui serve [--port 8000] [--reload] [--style STYLE]          # Serve site
aiui run app.py [--port 8000] [--reload] [--style STYLE]     # Run AI server
aiui run chat.yaml [--port 8000] [--style chat]              # Run YAML chat
aiui dev -e examples [--port 9000]                           # Dev dashboard
aiui doctor [--json]                                         # Diagnostics
aiui test chat|memory|sessions|endpoints|all                 # Run tests
```

### Management Commands

```bash
# Sessions
aiui sessions list|create|get|delete|messages

# Memory
aiui memory list|add|search|clear|status|context

# Skills
aiui skills list|status|discover

# Agents & Provider
aiui provider status|health|agents

# Config
aiui config get|set|list|history

# Schedules
aiui schedule list|add|remove|status

# Approvals
aiui approval list|pending|resolve

# Workflows
aiui workflows list|run|status|runs

# Hooks
aiui hooks list|trigger|log

# Eval
aiui eval status|list|scores|judges|run

# Traces
aiui traces status|list|spans|get

# Pages
aiui pages list|ids

# Features
aiui features list|status

# Health
aiui health [--detailed]
```

## YAML Configuration

### Site Config (`config.yaml` in `~/.praisonaiui/`)

```yaml
site:
  title: "PraisonAI"
  logo: "🦞"
  theme:
    preset: "zinc"       # 22 Tailwind color presets
    radius: "md"         # none, sm, md, lg, xl
    darkMode: true

pages:
  disabled:
    - debug
    - telemetry
```

### Static Site Config (`aiui.template.yaml`)

```yaml
schemaVersion: 1

site:
  title: "My Docs"
  theme:
    preset: "blue"
    darkMode: true

content:
  docs:
    dir: "./docs"

templates:
  docs:
    layout: "ThreeColumnLayout"
```

## Theme Presets

22 Tailwind color presets with automatic dark/light mode:

`zinc` `slate` `stone` `gray` `neutral` `red` `orange` `amber` `yellow` `lime` `green` `emerald` `teal` `cyan` `sky` `blue` `indigo` `violet` `purple` `fuchsia` `pink` `rose`

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `OPENAI_API_KEY` | OpenAI API key | — |
| `PRAISONAI_MODEL` | Default model | `gpt-4o-mini` |
| `AIUI_DATA_DIR` | Data directory | `~/.praisonaiui` |
| `AIUI_CONFIG` | Config file path | `aiui.template.yaml` |
| `AIUI_OUTPUT` | Build output dir | `aiui` |

## Architecture

```
Dashboard Mode:                        Docs Mode:
app.py  →  aiui run  →  Server         aiui.template.yaml  →  aiui build  →  aiui/
               ↓                                                                ├── index.html
         http://localhost:8000                                                  ├── docs/*.md
         ├── /api/chat/ws (WebSocket)                                           ├── ui-config.json
         ├── /api/pages                                                         └── assets/
         ├── /api/agents
         ├── /sessions
         └── /ui-config.json
```

## Development

```bash
git clone https://github.com/MervinPraison/PraisonAIUI.git
cd PraisonAIUI
pip install -e .[dev]
pytest tests -v
```

## License

MIT © [Praison Limited](https://praison.ai)
