# Quick Start

Run a chat app, connect it to a model, then try the other UI styles.

## Install

Python 3.10 or higher:

```bash
pip install aiui
```

## 1. A chat app

Create `app.py`:

```python
import praisonaiui as aiui


@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You said: {message}")
```

Run it:

```bash
aiui run app.py
```

Open http://127.0.0.1:8000 and send a message. If port 8000 is taken, `aiui run`
picks the next free port and prints the URL it used.

An app that only has a `@aiui.reply` callback opens in the `chat` style. The
same app is
[`examples/python/01-chat`](https://github.com/MervinPraison/PraisonAIUI/blob/main/examples/python/01-chat/app.py).

## 2. Reply with a model

Stream tokens from any client library with `aiui.stream_token()`. With OpenAI
(`pip install openai`, then `export OPENAI_API_KEY=...`):

```python
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

## 3. Try the React app shell

```bash
aiui run app.py --style app
```

`app` is the opt-in React app shell: the same callbacks, with a sidebar, a
command palette and selectable layouts (`chat-canvas` by default). See
[React app shell](../features/react-shell.md) and
[Layouts](../features/layouts.md).

## 4. Add a dashboard page

Register a page with `@aiui.page`. An app with pages opens in the `dashboard`
style, with your page in the sidebar next to the built-in ones:

```python
import praisonaiui as aiui


@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You said: {message}")


@aiui.page("metrics", title="Metrics", icon="📊")
async def metrics():
    return aiui.layout([
        aiui.columns([
            aiui.card("Users", value=1234),
            aiui.card("Uptime", value="99.9%", footer="last 30 days"),
        ]),
        aiui.table(headers=["Name", "Value"], rows=[["Alpha", 100], ["Beta", 200]]),
    ])
```

How the style is chosen: `aiui run` detects it from the callbacks you
registered (`@aiui.reply` only gives `chat`, `@aiui.page` gives `dashboard`,
`@aiui.profiles` plus registered agents gives `agents`). `aiui.set_style()` in
the app overrides the detection, and `--style` on the command line overrides
both. See [UI Styles](../features/styles.md).

## 5. A chat agent from YAML

A YAML file can define the agent without Python. It runs on PraisonAI Agents,
so install that first: `pip install praisonaiagents` (or the full
`pip install "aiui[praisonai]"`), and set `OPENAI_API_KEY`.

```yaml
# chat.yaml
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
aiui init --template docs        # writes aiui.template.yaml
mkdir docs && echo "# Hello" > docs/index.md
aiui serve                       # builds into ./aiui, then serves it
```

Open http://127.0.0.1:8000/docs/. To publish it, see
[Deploy to GitHub Pages](github-pages.md).

## If something is wrong

With the server running, in another terminal:

```bash
aiui doctor                    # structured diagnostics
aiui health --detailed         # per-feature health
```

## Next steps

- [CLI Usage](cli.md): the commands you will use most
- [Python API](../api/python.md): decorators, message functions, `set_*` setters
- [Configuration](../concepts/configuration.md): the YAML file
