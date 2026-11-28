# Quick Start

> Run a chat app, connect it to a model, then try the other UI styles and layouts.

Run a chat app, connect it to a model, then try the other UI styles and layouts.

## Install

Python 3.10 or higher:

```bash
pip install aiui
```

## 1. A chat app

Scaffold a starter app for any framework (`agent`, `openai`, `anthropic`, `langgraph`, `crewai`, `pydantic-ai`, `praisonai`, or `dashboard`):

```bash
aiui init --template agent
aiui run app.py
```

Or create `app.py` directly:

```python title="app.py"
import praisonaiui as aiui


@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You said: {message}")
    # Render any of the 81 UI blocks (or DataFrames / Plotly figures) inline in chat:
    await aiui.send_block(aiui.metric("Status", value="Ready", delta="Live"))
```

Run it:

```bash
aiui run app.py
```

Open http://127.0.0.1:8000 and send a message.

> **Tip:**
> If port 8000 is taken, `aiui run` picks the next free port and prints the URL
> it used.

`aiui run app.py` opens in the React app shell (`style: app`) in **focused mode**
(Chat + your own pages). Pass `--preset agent` to add Sessions, Approvals, Usage
and Memory, or `--preset ops` for the full control plane. The minimal example is
[`examples/python/01-chat`](https://github.com/MervinPraison/PraisonAIUI/blob/main/examples/python/01-chat/app.py).

## 2. Reply with a model

Stream tokens from any client library with `aiui.stream_token()`. With OpenAI
(`pip install openai`), set your key first:

### macOS and Linux

```bash
export OPENAI_API_KEY=sk-...
```

### Windows

```powershell
setx OPENAI_API_KEY sk-...
```

Then open a new terminal.

```python title="app.py" {9,14-16}
import praisonaiui as aiui
from openai import AsyncOpenAI

client = AsyncOpenAI()  # reads OPENAI_API_KEY


@aiui.reply
async def on_message(message: str):
    stream = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": message}],
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            await aiui.stream_token(chunk.choices[0].delta.content)
```

`aiui run` also reads a `.env` file in the current folder (and
`~/.praisonai/.env`) without overriding variables already set.
[`examples/python/03-chat-with-ai`](https://github.com/MervinPraison/PraisonAIUI/blob/main/examples/python/03-chat-with-ai/app.py)
adds conversation history, a welcome message and starters.

## 3. Other layouts and the classic chat

The app shell has selectable layouts. Pick one per run with `AIUI_LAYOUT`, or
in the app with `aiui.set_layout()`:

```bash
AIUI_LAYOUT=chat-canvas aiui run app.py   # the chat beside a canvas of artifacts
AIUI_LAYOUT=workbench aiui run app.py     # a quiet sidebar of chats
aiui run app.py --style chat              # the classic chat style instead of the app shell
```

See [React app shell](https://ui.praison.ai/docs/features/react-shell.md) and
[Layouts](https://ui.praison.ai/docs/features/layouts.md) for every layout.

## 4. Add a custom page or 5-line function interface

Register a custom page with `@aiui.page` — or wrap any Python function (including
`yield` generators) with `aiui.interface()`. An app with pages opens in the
React app shell (`style: app`) in focused mode (Chat + your own pages); pass
`--preset ops` for all built-in ops views, or `--style dashboard` for the legacy
vanilla dashboard:

```python title="app.py"
import praisonaiui as aiui


@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You said: {message}")


@aiui.page("metrics", title="Metrics", icon="bar-chart-2", group="App")
async def metrics():
    return aiui.layout([
        aiui.columns([
            aiui.container([
                aiui.card("Users", value=1234),
                aiui.table([{"Name": "Alpha", "Value": 100}, {"Name": "Beta", "Value": 200}], searchable=True),
            ]),
            aiui.chat_panel(title="Ask about metrics", height=460),
        ]),
    ])
```

How the style is chosen: `--style` on the command line wins, then
`aiui.set_style()` in the app. Without either, `aiui run` opens the React app
shell (`app`), or `agents` when `@aiui.profiles` is paired with registered
agents. See [UI Styles](https://ui.praison.ai/docs/features/styles.md) and
[Build a focused app](https://ui.praison.ai/docs/guides/focused-app.md).

## 5. A chat agent from YAML

A YAML file can define the agent without Python. It runs on PraisonAI Agents,
so install that first: `pip install praisonaiagents` (or the full
`pip install "aiui[praisonai]"`), and set `OPENAI_API_KEY`.

```yaml title="chat.yaml"
name: My Assistant
instructions: You are a helpful assistant. Be concise.
model: gpt-4o-mini
welcome: "Hi! How can I help you today?"
starters:
  - label: "What can you do?"
    message: "Tell me about your capabilities"
```

```bash
aiui run chat.yaml
```

## 6. A documentation site

`aiui build` turns a folder of Markdown into a static site:

```bash
aiui init --template docs        # writes aiui.yaml
mkdir docs && echo "# Hello" > docs/index.md
aiui serve                       # builds into ./aiui, then serves it
```

Open http://127.0.0.1:8000/docs/. To publish it, see
[Deploy to GitHub Pages](https://ui.praison.ai/docs/getting-started/github-pages.md).

## If something is wrong

> **Warning:**
> Never paste an API key into `app.py` or `aiui.yaml`: read it from the
> environment, as above.

With the server running, in another terminal:

```bash
aiui doctor                    # structured diagnostics
aiui health --detailed         # per-feature health
```

## Next steps

- [Step-by-step: Agent UI](https://ui.praison.ai/docs/tutorials/first-chat.md)
  Build a full AI app one feature at a time, from first message to production deploy.
- [Step-by-step: A2UI Generative UI](https://ui.praison.ai/docs/a2ui/quickstart.md)
  Push live agent-driven surfaces and interactive canvases over WebSocket and JSONL.
- [Step-by-step: Dashboards & Plugins](https://ui.praison.ai/docs/guides/server-pages.md)
  Build interactive data pages, spreadsheets, whiteboards and `@aiui/sdk` plugins.
- [Step-by-step: Docs UI](https://ui.praison.ai/docs/docs-ui/overview.md)
  Publish a searchable Markdown documentation site with SEO, OpenAPI and `llms.txt`.

## Related pages

- [Build a focused app](https://ui.praison.ai/docs/guides/focused-app.md)
- [UI Styles](https://ui.praison.ai/docs/features/styles.md)
- [Docs UI Overview](https://ui.praison.ai/docs/docs-ui/overview.md)
