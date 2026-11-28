---
title: PraisonAIUI
nav_title: Introduction
description: A web UI for AI agents in Python. Streaming chat, an artifacts canvas, selectable layouts, a dashboard and docs sites, from one pip package.
layout: home
hero:
  name: PraisonAIUI
  text: A web UI for your AI agents, in Python
  tagline: Stream replies, show tool calls and approvals, open what the agent makes in a canvas, and ship it as a chat app, a dashboard or a docs site. One pip package, one command.
  image: images/app-shell-chat-canvas-light.webp
  imageDark: images/app-shell-chat-canvas-dark.webp
  imageAlt: The app shell in the Chat and Canvas layout and its Paper look. On the left an agent compares sorting algorithms, ran a tool and waits for approval to install numpy; on the right the canvas shows the comparison table above the sort_demo.py script it wrote
  actions:
    - text: Step-by-step tutorial
      link: tutorials/01-first-chat.md
    - text: Quick start
      link: getting-started/quickstart.md
      theme: alt
features:
  - title: Chat and canvas
    icon: message-square
    details: Streaming replies with reasoning, tool calls, inline approvals, attachments and images. Code, tables and files the agent writes open in a versioned canvas beside the chat.
    link: features/react-shell.md
    linkText: React app shell
  - title: Layouts
    icon: panels-top-left
    details: One app, six layouts, from focused Chat and Chat + Canvas to Mission Control. Choose one in YAML, Python or an environment variable; viewers can switch.
    link: features/layouts.md
    linkText: Layouts
  - title: Plugins
    icon: plug
    details: Add pages, settings sections, nav groups and themes from a Python package. React pages use the @aiui/sdk, so a plugin can do what a built-in page does.
    link: features/plugins.md
    linkText: UI plugins
  - title: Docs sites
    icon: book-open
    details: One YAML file and a folder of Markdown become a searchable docs site with tabs, light and dark themes, SEO metadata and llms.txt. This site is built that way.
    link: features/content-sources.md
    linkText: Content sources
  - title: Dashboard
    icon: layout-dashboard
    details: Sessions, agents, memory, knowledge, schedules, logs and usage pages out of the box, plus your own pages from @aiui.page with cards, tables and charts.
    link: features/dashboard.md
    linkText: Dashboard
  - title: Auth and security
    icon: shield-check
    details: Sign-in, deny-by-default auth on every route and WebSocket, single-use WebSocket tickets, a cross-origin guard and a Host check for local servers.
    link: features/deployment.md
    linkText: Deployment and security
---

## Run it in 30 seconds

<Steps>
<Step title="Install">
Python 3.10 or higher.

```bash
pip install aiui
```
</Step>
<Step title="Scaffold or write app.py">
Scaffold a starter for any agent framework (`agent`, `openai`, `anthropic`, `langgraph`, `crewai`, `pydantic-ai`, `praisonai`, or `dashboard`), or write `app.py` directly:

```bash
aiui init --template agent
```

```python title="app.py"
import praisonaiui as aiui


@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You said: {message}")
    await aiui.send_block(aiui.metric("Status", value="Online", delta="Live"))
```
</Step>
<Step title="Run it">
```bash
aiui run app.py
```

Open <http://127.0.0.1:8000>. `aiui run app.py` opens cleanly in **focused mode**
(Chat + your own pages) in the React app shell. Pass `--preset agent` for
Sessions, Approvals, Usage and Memory, `--preset ops` for the full control plane,
or `AIUI_LAYOUT=chat-canvas aiui run app.py` to open the side canvas.
</Step>
</Steps>

## Pick a starting point

<CardGroup cols={3}>
<Card title="Agent UI" icon="message-square" href="chat-ui/overview.md">
Build streaming AI agent interfaces with starters, profiles, reasoning steps, tool calls, HITL approvals and an artifacts canvas.
</Card>
<Card title="App & Dashboard" icon="panels-top-left" href="app-ui/overview.md">
Combine chat with 5 selectable layouts, Python or YAML data pages, notifications, themes and built-in ops views.
</Card>
<Card title="A2UI (Generative UI)" icon="sparkles" href="a2ui/quickstart.md">
Let agents push live interactive surfaces, forms and controls over JSONL and WebSocket into a split Chat + Canvas workspace.
</Card>
</CardGroup>

<CardGroup cols={3}>
<Card title="UI Components" icon="component" href="components/overview.md">
Explore all 81 Python and YAML UI builders — inline chat blocks, split-pane chat panels, file uploads, spreadsheets, whiteboards, DataFrames, Plotly charts and forms.
</Card>
<Card title="Docs UI" icon="book-open" href="docs-ui/overview.md">
Turn a folder of Markdown and one `aiui.yaml` into a fast, searchable documentation site with SEO, OpenAPI and `llms.txt`.
</Card>
<Card title="Plugins & Security" icon="plug" href="features/plugins.md">
Extend the app with pip-installable `@aiui/sdk` React pages and themes, behind deny-by-default auth and reverse proxies.
</Card>
</CardGroup>

Looking something up? The [CLI](api/cli.md), the [Python API](api/python.md)
and the [YAML configuration](concepts/configuration.md) cover every command,
function and key.

PraisonAIUI is MIT licensed. Install it from [PyPI](https://pypi.org/project/aiui/)
as `aiui`; the import name is `praisonaiui` and the command is `aiui`.
