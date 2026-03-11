# Quick Start

Get a working AI dashboard in under 60 seconds.

## Prerequisites

- Python 3.10+
- An OpenAI API key (or compatible provider)

```bash
export OPENAI_API_KEY="sk-..."
```

## Install

```bash
pip install aiui
```

## Option 1: Dashboard Mode (recommended)

Create an `app.py`:

```python
import praisonaiui as aiui

aiui.set_style("dashboard")
aiui.set_pages(["chat", "agents", "memory", "sessions", "config"])
aiui.set_branding(title="PraisonAI", logo="🦞")

aiui.register_agent({
    "agent_id": "assistant",
    "name": "Assistant",
    "description": "General purpose AI assistant",
    "instructions": "You are a helpful assistant. Be concise.",
    "model": "gpt-4o-mini",
    "icon": "🤖",
})

@aiui.reply
async def on_reply(message):
    """Handle incoming chat messages."""
    # The registered agent handles the reply automatically
    pass
```

Run:

```bash
aiui run app.py
```

Open **http://localhost:8000** — your dashboard is live with chat, agent management, memory, sessions, and config pages.

## Option 2: YAML Chat Mode

Create a `chat.yaml`:

```yaml
name: My Assistant
instructions: You are a helpful assistant.
model: gpt-4o-mini
welcome: "Hi! How can I help you today?"
starters:
  - label: "What can you do?"
    message: "Tell me about your capabilities"
  - label: "Help me write"
    message: "Help me draft an email"
tools:
  - web_search
features: true
```

Run:

```bash
aiui run chat.yaml
```

## Option 3: Documentation Mode

Generate a static docs site from Markdown files:

```bash
aiui init --template docs
# Edit docs/*.md files
aiui build
aiui serve
```

## Next Steps

- **[CLI Reference](cli.md)** — Full command reference with all 22 command groups
- **[Python API](../api/python.md)** — SDK function reference
- **[Dashboard Features](../features/dashboard.md)** — All 24 dashboard pages
- **[Configuration](../concepts/configuration.md)** — YAML configuration guide

## Diagnostics

If something isn't working:

```bash
aiui doctor               # Check server health
aiui health --detailed     # Detailed health check
aiui test all              # Run all integration tests
```
