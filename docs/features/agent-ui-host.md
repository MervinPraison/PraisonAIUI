# Agent UI host — modular dashboard shell

PraisonAIUI can host any AI agent backend behind a **modular dashboard shell**: pages, views, layout components, optional plugins, and branding — without forking the frontend.

## Architecture

```text
YAML / Python config → server (pages API, plugins.json) → dashboard.js shell
                              ↓
         registerView / BUILTIN_VIEWS / layout JSON / registerComponent
                              ↓
                    renderComponent() + theme (--db-*)
```

**Extension priority** (first match wins):

1. `window.aiui.registerView(pageId, …)`
2. Dashboard manifest plugins (`dashboard-plugins/*/manifest.json`)
3. Built-in view modules (`plugins/views/*.js` via `BUILTIN_VIEWS`)
4. Server `aiui.layout()` JSON from `@aiui.page()`
5. `window.aiui.registerComponent(type, …)` inside `renderComponent`
6. Generic JSON fallback viewer

## Video Studio

For YAML scene authoring with an external PraisonAI Video engine, see [Video Studio](video-studio.md).

## Quick start (external agent)

```python
import praisonaiui as aiui
from praisonaiui.server import create_app

aiui.set_style("dashboard")
aiui.set_branding(title="Acme Agents", logo="A")
aiui.set_pages(["chat", "tasks", "sessions", "config"])
aiui.set_dashboard(modules=["jobs"], sidebar=True, page_header=True)

@aiui.page("tasks", title="Tasks", icon="📋", group="Work")
async def tasks_page():
    return aiui.layout([
        aiui.board(columns=[
            {"id": "todo", "title": "Todo", "cards": [aiui.card("Review PR", footer="agent-a")]},
            {"id": "done", "title": "Done", "cards": [aiui.card("Ship feature")]},
        ]),
    ])

app = create_app()
```

See [`examples/python/external-agent-dashboard/app.py`](../../examples/python/external-agent-dashboard/app.py).

## `window.aiui` extension API

| API | Purpose |
|-----|---------|
| `version` | Shell protocol version (`'1'`) |
| `registerView(pageId, renderFn, cleanup?)` | Replace or add a full page renderer |
| `registerComponent(type, renderFn)` | Override a layout component type |
| `registerSlot(name, renderFn)` | Inject DOM into named slots |
| `sdk.fetchJSON(url, opts?)` | Authenticated fetch helper |
| `sdk.el(tag, attrs?, children?)` | Small DOM builder |
| `sdk.themeVar('--db-*', fallback?)` | Read theme CSS variables |
| `sdk.createBoard(root, { fetch, pollMs? })` | Live board with optional polling |

### Slots

| Slot id | Where it renders |
|---------|------------------|
| `shell:sidebar:footer` | Bottom of sidebar (default: health hint) |
| `page:{pageId}:toolbar` | Right side of page header |

Register only what you need; omit slots you do not use.

## Layout components (Python → JS)

Define pages with `@aiui.page()` returning `aiui.layout([...])`. Types are implemented once in [`ui.py`](../../src/praisonaiui/ui.py) and [`dashboard.js`](../../src/praisonaiui/templates/frontend/plugins/dashboard.js).

**Kanban / board:** use `aiui.board(columns=[...])`. Columns contain `id`, `title`, and `cards` (from `aiui.card()` or dicts). The shell renders via `renderBoard`, composing existing card renderers (DRY).

## Optional dashboard modules

Load heavy built-ins only when listed:

```python
aiui.set_dashboard(modules=["jobs", "auth", "api"])
```

```yaml
dashboard:
  modules: [jobs]
```

This adds `jobs.js`, `auth.js`, or `api.js` to the plugin chain and maps them in `BUILTIN_VIEWS`. `feedback` is always available as a built-in view when the page is enabled.

## Third-party dashboard plugins

Place folders under:

- `~/.praisonai/dashboard-plugins/{name}/`
- Or `src/praisonaiui/templates/frontend/dashboard-plugins/{name}/` (shipped examples)

Each plugin needs `manifest.json` + `index.js` (optional `styles.css`):

```json
{
  "name": "my-board",
  "label": "My board",
  "icon": "📋",
  "tab": { "path": "/my-board" },
  "entry": "index.js"
}
```

The server exposes:

- `GET /api/dashboard/plugins` — manifest list
- `GET /dashboard-plugins/{name}/{path}` — static assets

Plugins register views in `index.js`:

```javascript
window.aiui.registerView('my-board', async (container) => {
  window.aiui.sdk.createBoard(container, {
    fetch: async () => ({ columns: [...] }),
  });
});
```

Sample: [`sample-board`](../../src/praisonaiui/templates/frontend/dashboard-plugins/sample-board/).

## Granular control — opt-in / opt-out

| What you control | How | Example |
|------------------|-----|---------|
| UI mode | `aiui.set_style(...)` | `"dashboard"`, `"chat"`, `"docs"` |
| Sidebar pages | `aiui.set_pages([ids])` whitelist | `["chat", "sessions"]` |
| Hide built-ins | YAML `pages.disabled: [...]` | Blacklist in server |
| Sidebar on/off | `set_dashboard(sidebar=False)` | Chat-only full width |
| Page title bar | `set_dashboard(page_header=False)` | Cleaner surface |
| Optional modules | `set_dashboard(modules=[...])` | `["jobs"]` only |
| Third-party tabs | Install chosen `dashboard-plugins/` folders | Manifest per plugin |
| Shell chrome | `registerSlot` | Header/footer widgets |
| Look only | `set_theme`, `set_branding`, `set_custom_css` | White-label |
| Replace one page | `registerView(pageId, ...)` | Override built-in |
| Board UI | `aiui.board()` or plugin | Not in default nav |

**Note:** `@aiui.page()` custom pages are **not** filtered by `set_pages()` — only built-in dashboard pages are. Remove custom pages from code to hide them.

### Example profiles

```python
# Chat-only
aiui.set_style("dashboard")
aiui.set_pages(["chat"])
aiui.set_dashboard(sidebar=False, page_header=False)

# Ops console — no chat
aiui.set_pages(["sessions", "agents", "logs", "config", "usage", "approvals"])
```

```yaml
style: dashboard
pages:
  enabled: [chat, agents, memory, sessions]
dashboard:
  sidebar: true
  pageHeader: true
  modules: [jobs]
  plugin_dirs: [/opt/my-agent/plugins]
```

CLI: `aiui pages ids` lists built-in page ids for whitelists.

## DRY rules for contributors

1. Add new layout types in **`ui.py`** and one `case` in **`dashboard.js`**.
2. Page-specific UI belongs in **`plugins/views/*.js`**, delegating to shared modules (`jobs.js`, etc.) via thin wrappers.
3. Reuse **`_helpers.js`** (`pageToolbar`, `filterChips`, `searchInput`, `modalShell`, `toast`).
4. Boards compose **`card`** / **`columns`** — do not duplicate card markup in plugins.

## Related files

| File | Role |
|------|------|
| [`server.py`](../../src/praisonaiui/server.py) | Pages API, `set_dashboard`, plugin chain |
| [`dashboard_plugins.py`](../../src/praisonaiui/dashboard_plugins.py) | Manifest discovery and static routes |
| [`dashboard.js`](../../src/praisonaiui/templates/frontend/plugins/dashboard.js) | Shell, registries, renderers |
| [`schema/models.py`](../../src/praisonaiui/schema/models.py) | `DashboardConfig.modules`, `plugin_dirs` |
