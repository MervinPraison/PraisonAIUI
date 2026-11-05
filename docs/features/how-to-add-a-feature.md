# How to Add a Feature to PraisonAIUI

This guide explains every way a user can extend PraisonAIUI — and which approach fits your use case.

## Extension Points at a Glance

| I want to add… | Use | Side | Effort |
|----------------|-----|------|--------|
| A new dashboard page | `@aiui.page()` | Server | 5 lines |
| A form that saves data | `aiui.form_action()` + `@aiui.register_page_action()` | Both | 15 lines |
| A brand-new UI component type | `window.aiui.registerComponent()` + dict type | Both | 20 lines |
| A page rendered entirely in the browser | `window.aiui.registerView()` | Client | 10 lines |
| Ship client-side JS from Python | `aiui.set_custom_js(path)` | Server | 1 line |
| A typed contract for a component | `aiui.register_component_schema(type, schema)` | Server | 5 lines |
| A custom theme | `aiui.register_theme()` | Server | 1 line |
| A new AI backend | Subclass `aiui.BaseProvider` | Server | ~50 lines |
| A whole new feature module (routes, state) | Subclass `BaseFeatureProtocol` + `register_feature()` | Server | ~100 lines |
| Persistence backend | Subclass `aiui.BaseDataStore` | Server | ~50 lines |

---

## Decision Flow

```
┌─────────────────────────────────────┐
│   What do you want to add?          │
└────────────────┬────────────────────┘
                 │
     ┌───────────┼───────────────────────────────┐
     ▼           ▼                               ▼
  A PAGE    A COMPONENT                  A BACKEND THING
     │           │                               │
     ▼           ▼                               ▼
 @aiui.page  Is it in the 48             Is it a provider?
     │       built-in components?           → BaseProvider
     ▼              │                     Is it storage?
 Compose from       │                        → BaseDataStore
 existing       Yes │   No                 Is it a feature with
 components         │    │                 its own routes/state?
     │              ▼    ▼                    → BaseFeatureProtocol
     │          Use it   Custom component
     │                   via registerComponent
     ▼
 Need form data back?
    → add form_action
    + @register_page_action
```

---

## 1. Add a new page

**Goal**: Show a new page in the sidebar with custom content.

```python
import praisonaiui as aiui

@aiui.page("analytics", title="Analytics", icon="📈", group="Custom")
async def analytics():
    return aiui.layout([
        aiui.columns([
            aiui.card("Revenue", value="$12,340"),
            aiui.card("Users", value="1,204"),
        ]),
        aiui.chart(data=[10, 20, 30], type="line"),
    ])
```

**What happens**:

1. The page is registered in the server's page registry.
2. It appears in the sidebar at `/api/pages`.
3. When the user clicks it, the frontend fetches `/api/pages/analytics/data`.
4. Your handler returns a dict; `aiui.layout()` wraps it in `{"_components": [...]}`.
5. `dashboard.js` loops over `_components` and calls `renderComponent(comp)` on each.

See [Dashboard](dashboard.md) for the full `@aiui.page()` signature.

---

## 2. Add an interactive form

**Goal**: Let users submit data from the UI back to your Python code.

```python
import praisonaiui as aiui

_saved = []

@aiui.page("contact", title="Contact", icon="📝")
async def contact_form():
    return aiui.layout([
        aiui.form_action(
            "contact",
            submit_label="Save",
            children=[
                aiui.text_input("Name"),
                aiui.text_input("Email"),
                aiui.select_input("Role", options=["Engineer", "PM"]),
                aiui.checkbox_input("Subscribe", checked=True),
            ],
        ),
    ])

@aiui.register_page_action("contact")
async def handle_contact(data: dict) -> dict:
    _saved.append(data)
    return {"status": "saved", "count": len(_saved)}
```

**What happens**:

1. The form renders with all inputs.
2. On submit, the frontend POSTs to `/api/pages/contact/action`.
3. The server invokes `handle_contact(data)` with the form values keyed by label.
4. The returned dict is sent back to the browser as JSON.

> **Note**: Input labels become dict keys. Use distinct labels per input.

---

## 3. Add a custom component type

**Goal**: Add a new UI widget that doesn't exist in the 48 built-ins.

### Step 1 — Python side: return a dict with your new type

```python
@aiui.page("activity", title="Activity", icon="🕒")
async def activity():
    return aiui.layout([
        {
            "type": "timeline",   # ← custom type
            "events": [
                {"time": "09:00", "label": "Deploy", "icon": "🚀"},
                {"time": "13:00", "label": "Review", "icon": "🔍"},
            ],
        },
    ])
```

**If you stop here**, the component renders as formatted JSON (graceful fallback).

### Step 2 — Client side: register a renderer

Put this in a `plugin.js` file (or paste into DevTools Console):

```javascript
window.aiui.registerComponent('timeline', function(comp) {
    const el = document.createElement('div');
    el.className = 'db-timeline';
    (comp.events || []).forEach(ev => {
        const row = document.createElement('div');
        row.innerHTML = `<b>${ev.icon}</b> ${ev.time} — ${ev.label}`;
        el.appendChild(row);
    });
    return el;
});
```

**What happens**:

1. `renderComponent(comp)` checks `COMPONENT_REGISTRY[comp.type]` before the built-in switch.
2. Your renderer takes priority and returns a DOM element.

### Auto-load `plugin.js` from Python

Use `aiui.set_custom_js(path)` to ship client-side extensions directly from
your app:

```python
import praisonaiui as aiui

aiui.set_custom_js("plugin.js")   # reads file, serves at /custom.js,
                                   # injects <script> after the plugin loader
```

The script runs **after** the plugin loader, so `window.aiui.registerView`
and `window.aiui.registerComponent` are ready when it executes. No DevTools
workaround needed.

---

## 4. Add a client-only page

**Goal**: A page rendered entirely in the browser — no server round-trip on navigation.

```javascript
// In plugin.js
window.aiui.registerView('live-feed', async (container) => {
    container.innerHTML = '<h1>Live Feed</h1>';
    const ws = new WebSocket('wss://your-feed.example.com');
    ws.onmessage = (e) => {
        const div = document.createElement('div');
        div.textContent = e.data;
        container.appendChild(div);
    };
    // Store ws for cleanup
    container._ws = ws;
}, () => {
    // Cleanup when user navigates away
    if (container._ws) container._ws.close();
});
```

Still register a placeholder page in Python so it appears in the sidebar:

```python
@aiui.page("live-feed", title="Live Feed", icon="📡")
async def live_feed():
    return aiui.layout([aiui.text("Loading…")])
```

**What happens**:

1. `registerView` takes priority over the built-in + server-side rendering.
2. Navigation calls your `render(container)` function.
3. When the user navigates away, your `cleanup()` function runs.

---

## 5. Register a custom theme

```python
aiui.register_theme("ocean", {"accent": "#0077b6"})
aiui.set_theme(preset="ocean")
```

See [CSS Architecture](css-architecture.md) for all variables.

---

## 6. Add a new AI provider

```python
from praisonaiui.provider import BaseProvider, RunEvent, RunEventType

class MyProvider(BaseProvider):
    async def run(self, message, **kw):
        yield RunEvent(type=RunEventType.RUN_STARTED)
        yield RunEvent(type=RunEventType.RUN_CONTENT, token="Hello")
        yield RunEvent(type=RunEventType.RUN_COMPLETED, content="Hello")

aiui.set_provider(MyProvider())
```

See [Providers](../concepts/providers.md).

---

## 7. Add a feature module (advanced)

Features live in `praisonaiui/features/*.py` and implement `BaseFeatureProtocol`:

```python
from praisonaiui.features import BaseFeatureProtocol, register_feature
from starlette.routing import Route
from starlette.responses import JSONResponse

class MyFeature(BaseFeatureProtocol):
    name = "my-feature"
    feature_name = "my-feature"

    def routes(self):
        return [
            Route("/api/my-feature", self._handler, methods=["GET"]),
        ]

    async def _handler(self, request):
        return JSONResponse({"data": "hello"})

register_feature(MyFeature())
```

See [Protocol Architecture](protocol-architecture.md).

---

## Is This the Best Approach?

### Strengths ✅

- **Clean separation** — Python returns dicts, client renders DOM. You can mix and match server/client work per-feature.
- **Graceful degradation** — Unknown component types render as JSON (no crashes).
- **Zero build step for Python users** — No webpack/TS compile required for server-side pages.
- **Single source of truth** — Every feature has a protocol ABC.
- **Hot-swap friendly** — `window.aiui.registerView/Component` updates live without server restart.

### Previously reported gaps — all closed ✅

| Gap | Resolution |
|-----|------------|
| No `aiui.set_custom_js(path)` | **Implemented** — serves the file at `/custom.js` and injects a `<script>` tag after the plugin loader. Unit tests: `tests/unit/test_custom_js.py` (10 tests). |
| `form_action` uses input labels as keys | **Implemented** — every form input now accepts an optional `name=` kwarg that becomes the submit-key. Tests: `tests/unit/test_form_input_names.py` (18 tests). |
| No typed Python ⇄ JS contract | **Implemented** — `aiui.register_component_schema(type, schema)` + `GET /api/components/schemas`. Built-in schemas are auto-derived from `ui.py` signatures. Tests: `tests/unit/test_component_schemas.py` (9 tests). |
| `/api/features` cold-start slow | **Mitigated** — `info()` calls are parallelized via `asyncio.gather`. Warm calls are now instant; cold starts are dominated by LiteLLM import (out of scope). |
| `pygments 2.20` mkdocs build crash on `providers.md` | **Fixed** — `docs_hooks.py` patches `pymdownx.BlockHtmlFormatter.__init__` to coerce `filename=None` → `""`. |

### When NOT to use this approach

- **You need a full SPA with routing**: Use the Next.js adapter or scaffold a React project with `aiui init --frontend`.
- **Your UI needs TypeScript types**: Use the TypeScript SDK (`@praisonaiui/runtime`).
- **You need server-sent events beyond chat**: Extend `BaseFeatureProtocol` with a WebSocket route.

---

## Checklist for a New Feature

- [ ] Decide: is it a page, a component, or a backend module?
- [ ] Write the Python side first (returns a dict / routes).
- [ ] If you added a new component type: implement the JS renderer.
- [ ] Write a unit test (see `tests/unit/test_form_action.py` as an example).
- [ ] Add a runnable example under `examples/python/`.
- [ ] Update the docs under `docs/features/` or `docs/api/`.
- [ ] Run `mkdocs build --strict`.
- [ ] Run `pytest tests/unit -v`.
