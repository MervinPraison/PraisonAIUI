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
  imageAlt: The app shell in the Chat and Canvas layout, with a conversation on the left and the code the agent wrote open in the canvas on the right
  actions:
    - text: Quick start
      link: getting-started/quickstart.md
    - text: View on GitHub
      link: https://github.com/MervinPraison/PraisonAIUI
      theme: alt
features:
  - title: Chat and canvas
    icon: message-square
    details: Streaming replies with reasoning, tool calls, inline approvals, attachments and images. Code, tables and files the agent writes open in a versioned canvas beside the chat.
    link: features/react-shell.md
    linkText: React app shell
  - title: Layouts
    icon: panels-top-left
    details: One app, five frames, from Chat and Canvas to Mission Control. Choose one in YAML, Python or an environment variable; viewers can switch.
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

Python 3.10 or higher.

```bash
pip install aiui
```

Create `app.py`:

```python
import praisonaiui as aiui


@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You said: {message}")
```

Start it and open <http://127.0.0.1:8000>:

```bash
aiui run app.py
```

The app opens in the React app shell, in its `chat` layout. Connect a model
with `aiui.stream_token()` in the [quick start](getting-started/quickstart.md),
or open the canvas with `AIUI_LAYOUT=chat-canvas aiui run app.py`.

## Pick a starting point

| You want to | Start with |
|---|---|
| Put a chat UI on an agent you already have | [Quick start](getting-started/quickstart.md) |
| Choose between the app shell, chat, dashboard and the other styles | [UI styles](features/styles.md) |
| Try the layouts and the artifacts canvas | [Layouts](features/layouts.md) |
| Build your own page or extension | [UI plugins](features/plugins.md) |
| Publish Markdown docs | [Content sources](features/content-sources.md) |
| Run it behind a proxy, with sign-in | [Deployment](features/deployment.md) |
| Look up a command or function | [CLI](api/cli.md), [Python API](api/python.md), [YAML configuration](concepts/configuration.md) |

PraisonAIUI is MIT licensed. Install it from [PyPI](https://pypi.org/project/aiui/)
as `aiui`; the import name is `praisonaiui` and the command is `aiui`.
