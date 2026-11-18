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
| Nav group | Both pages under a "Hello" group: in the classic sidebar between the app's second and third groups, and in every built-in layout's nav | `HelloPlugin.nav_groups()` |
| Settings | A "Hello plugin" section in the shell's settings dialog ("Plugin settings" in the frame's nav, the classic header's sliders button or the palette); the blocks page greets with the saved word | `HelloPlugin.settings()`, `get_plugin_settings("hello", "greeting")` |
| Theme preset | "Sunrise theme" in the command palette | `HelloPlugin.themes()` (seed tokens) |
| CLI | `aiui hello greet NAME` | `HelloPlugin.cli_commands()` |

## Try it

```bash
pip install -e examples/plugins/aiui-hello-plugin
aiui plugins list
aiui plugins doctor
aiui hello greet Ada

# Plugin pages appear in the app shell (what `aiui run` opens)
aiui run app.py
```

Open `http://127.0.0.1:8000/hello` and `http://127.0.0.1:8000/hello-blocks`
(both are in the "Hello" nav group). Open the settings dialog with "Plugin
settings" in the sidebar (the sliders icon in the classic frame's header),
change the greeting, and press "Say hello" on `/hello-blocks`. The values are saved in
`$AIUI_DATA_DIR/plugin-settings/hello.json` (default `~/.praisonaiui`).

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
