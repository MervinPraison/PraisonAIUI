# PraisonAIUI

> A web UI for AI agents in Python. Streaming chat, an artifacts canvas, selectable layouts, a dashboard and docs sites, from one pip package.

## Run it in 30 seconds

1. **Install**

   Python 3.10 or higher.

   ```bash
   pip install aiui
   ```

2. **Write app.py**

   ```python title="app.py"
   import praisonaiui as aiui


   @aiui.reply
   async def on_message(message: str):
       await aiui.say(f"You said: {message}")
   ```

3. **Run it**

   ```bash
   aiui run app.py
   ```

   Open <http://127.0.0.1:8000>. The app opens in the React app shell, in its
   `chat` layout. Connect a model with `aiui.stream_token()` in the
   [quick start](https://ui.praison.ai/docs/getting-started/quickstart.md), or open the canvas with
   `AIUI_LAYOUT=chat-canvas aiui run app.py`.

## Pick a starting point

- [Put a chat UI on your agent](https://ui.praison.ai/docs/getting-started/quickstart.md)
  Stream replies, tool calls and approvals from the agent you already have.
- [Choose a UI style](https://ui.praison.ai/docs/features/styles.md)
  The app shell, the chat, the dashboard and the other styles, side by side.
- [Layouts and the canvas](https://ui.praison.ai/docs/features/layouts.md)
  Five frames for the same app, and the canvas the agent's work opens in.
- [Build a page or extension](https://ui.praison.ai/docs/features/plugins.md)
  Add pages, settings and themes from a Python package.
- [Publish Markdown docs](https://ui.praison.ai/docs/features/writing-docs.md)
  A folder of Markdown becomes a site like this one.
- [Deploy with sign-in](https://ui.praison.ai/docs/features/deployment.md)
  Behind a proxy, with auth on every route and WebSocket.

Looking something up? The [CLI](https://ui.praison.ai/docs/api/cli.md), the [Python API](https://ui.praison.ai/docs/api/python.md)
and the [YAML configuration](https://ui.praison.ai/docs/concepts/configuration.md) cover every command,
function and key.

PraisonAIUI is MIT licensed. Install it from [PyPI](https://pypi.org/project/aiui/)
as `aiui`; the import name is `praisonaiui` and the command is `aiui`.
