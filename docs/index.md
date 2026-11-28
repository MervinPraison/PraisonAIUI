# PraisonAIUI

> A web UI for AI agents in Python. Streaming chat, an artifacts canvas, selectable layouts, a dashboard and docs sites, from one pip package.

## Run it in 30 seconds

1. **Install**

   Python 3.10 or higher.

   ```bash
   pip install aiui
   ```

2. **Scaffold or write app.py**

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

3. **Run it**

   ```bash
   aiui run app.py
   ```

   Open <http://127.0.0.1:8000>. `aiui run app.py` opens cleanly in **focused mode**
   (Chat + your own pages) in the React app shell. Pass `--preset agent` for
   Sessions, Approvals, Usage and Memory, `--preset ops` for the full control plane,
   or `AIUI_LAYOUT=chat-canvas aiui run app.py` to open the side canvas.

## Pick a starting point

- [Agent UI](https://ui.praison.ai/docs/chat-ui/overview.md)
  Build streaming AI agent interfaces with starters, profiles, reasoning steps, tool calls, HITL approvals and an artifacts canvas.
- [App & Dashboard](https://ui.praison.ai/docs/app-ui/overview.md)
  Combine chat with 5 selectable layouts, Python or YAML data pages, notifications, themes and built-in ops views.
- [A2UI (Generative UI)](https://ui.praison.ai/docs/a2ui/quickstart.md)
  Let agents push live interactive surfaces, forms and controls over JSONL and WebSocket into a split Chat + Canvas workspace.

- [UI Components](https://ui.praison.ai/docs/components/overview.md)
  Explore all 81 Python and YAML UI builders — inline chat blocks, split-pane chat panels, file uploads, spreadsheets, whiteboards, DataFrames, Plotly charts and forms.
- [Docs UI](https://ui.praison.ai/docs/docs-ui/overview.md)
  Turn a folder of Markdown and one `aiui.yaml` into a fast, searchable documentation site with SEO, OpenAPI and `llms.txt`.
- [Plugins & Security](https://ui.praison.ai/docs/features/plugins.md)
  Extend the app with pip-installable `@aiui/sdk` React pages and themes, behind deny-by-default auth and reverse proxies.

Looking something up? The [CLI](https://ui.praison.ai/docs/api/cli.md), the [Python API](https://ui.praison.ai/docs/api/python.md)
and the [YAML configuration](https://ui.praison.ai/docs/concepts/configuration.md) cover every command,
function and key.

PraisonAIUI is MIT licensed. Install it from [PyPI](https://pypi.org/project/aiui/)
as `aiui`; the import name is `praisonaiui` and the command is `aiui`.
