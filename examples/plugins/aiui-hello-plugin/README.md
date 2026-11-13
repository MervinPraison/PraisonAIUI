# aiui-hello-plugin

The smallest complete PraisonAIUI plugin. It adds, to the React app shell:

| Surface | Where | Source |
|---|---|---|
| React page | `/hello` | `aiui_hello/static/hello.js` (plain ESM, no build step) |
| Blocks page | `/hello-blocks` | `HelloPlugin.routes()` returns a `_components` tree |
| Block type | `hello_badge` in any blocks page | `hello.js` calls `registerBlock` |
| Tool renderer | `get_weather` tool calls in chat | `hello.js` calls `registerToolRenderer` |
| CLI | `aiui hello greet NAME` | `HelloPlugin.cli_commands()` |

## Try it

```bash
pip install -e examples/plugins/aiui-hello-plugin
aiui plugins list
aiui plugins doctor
aiui hello greet Ada

# Plugin pages appear in the app shell (opt-in style)
AIUI_SHELL=app aiui run app.py
```

Open `http://127.0.0.1:8000/hello` and `http://127.0.0.1:8000/hello-blocks`.

When the server requires auth or is reached from another machine, plugin
browser code is off unless you enable the plugin by name:

```yaml
extensions:
  enabled: [hello]
```

See `docs/features/plugins.md` for the full contract.
