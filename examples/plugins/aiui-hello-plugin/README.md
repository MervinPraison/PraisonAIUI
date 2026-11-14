# aiui-hello-plugin

The smallest complete PraisonAIUI plugin. It adds, to the React app shell:

| Surface | Where | Source |
|---|---|---|
| React page | `/hello` | `aiui_hello/static/hello.js` (plain ESM, no build step) |
| Blocks page | `/hello-blocks` | `HelloPlugin.routes()` returns a `_components` tree |
| Block type | `hello_badge` in any blocks page | `hello.js` calls `registerBlock` |
| Tool renderer | `get_weather` tool calls in chat | `hello.js` calls `registerToolRenderer` |
| Slot | A "Hello" button in the header (`header:actions`) | `hello.js` calls `registerSlot(..., { id, order })` |
| Shell services | A toast and in-app navigation | `hello.js` calls `notify()` and `navigate()` |
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

`hello.js` imports everything from `@aiui/sdk` by name. Types for that module
are in `src/frontend/src/sdk/aiui-sdk.d.ts` (the frontend build also writes
`dist/aiui-sdk.d.ts`, and the installed package ships it as
`praisonaiui/templates/frontend/aiui-sdk.d.ts`); copy it into a plugin
project to type-check it.

See `docs/features/plugins.md` for the full contract.
