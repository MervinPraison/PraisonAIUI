# Settings, Themes, Multi-Surface & Pages

> Configure A2UI chat previews, themes, catalogs, custom renderers, same-page multi-surface, and multi-page workspaces.

Configure how A2UI surfaces appear, style them to match your brand, and decide whether to show everything on **one page** or across **multiple pages**.

## 1. All A2UI Settings

| Setting | Where | Purpose |
|---|---|---|
| `aiui.set_chat_preview(enabled=True, surface_id="main", width="40%")` | Python startup | Enables the split Chat + Canvas right-hand preview panel |
| `theme={"primaryColor": "#2563eb", "font": "Inter"}` | `createSurface` | Surface-level theme configuration |
| `catalog_id` | `createSurface` | Catalog URI (`"basic"`, v0.9 `catalogs/basic/catalog.json`, v0.10, or custom) |
| `send_data_model=True` | `createSurface` | Include client data-model state on user actions |
| `window.aiui.registerSurfaceRenderer(id, fn)` | Browser JS | Override rendering for a specific surface or custom catalog |

## 2. Same Page vs Different Pages

### Option A — Try everything on ONE page (Multi-Surface)

The built-in **Canvas** page (`/canvas`) includes a live **Surface selector** populated from `GET /api/surfaces`, so you can push several independent surfaces (`"main"`, `"form"`, `"metrics"`) and switch between them on the same page without reloading.

You can also embed a surface directly inside any custom `@aiui.page`:

```python
@aiui.page("studio", title="A2UI Studio", group="A2UI")
async def studio_page():
    return {"_surface": {"id": "main", "messages": build_studio_surface()}}
```

### Option B — Split across DIFFERENT pages

Combine dedicated pages in one app so users can chat alongside a live preview, open a full-screen workspace, and inspect settings separately:

```python
aiui.set_chat_preview(enabled=True, surface_id="main", width="40%")
aiui.set_pages([
    "chat-canvas",   # Split view: Chat left + live A2UI canvas right
    "canvas",        # Full-page multi-surface canvas with surface switcher
    "agent-canvas",  # Custom pre-seeded A2UI page
    "a2ui-settings", # Capabilities & catalog inspector page
])
```

Open any specific surface directly via query string: `/canvas?surface=checkout`.

## 3. Protocol Versions & v0.8 → v0.9 Compatibility

PraisonAIUI accepts **v0.8**, **v0.9**, and **v0.10** messages seamlessly:

| v0.8 (Upgraded automatically) | v0.9 / v0.10 (Native) |
|---|---|
| `beginRendering` (`styles`, `root`) | `createSurface` (`theme`, `catalogId`, `sendDataModel`) |
| `surfaceUpdate` (`{component: {Text: {...}}}`) | `updateComponents` (`{component: "Text", ...}`) |
| `dataModelUpdate` (`contents: [{key, valueString}]`) | `updateDataModel` (`path`, `value`) |
| `deleteSurface` | `deleteSurface` |
| `userAction` | `action` |

Use `aiui.v08_to_v09(messages)` in Python anytime you want to inspect or persist the upgraded v0.9 payload.

## 4. Custom Catalogs & Custom Renderers

If an agent uses a custom catalog URI (for example `https://acme.example/a2ui/shop.json`), register a custom renderer in custom JS (`aiui.set_custom_js(...)`):

```js
window.aiui.registerSurfaceRenderer("shop", (host, messages) => {
  host.textContent = `Custom catalog received ${messages.length} message(s)`;
});
```

## 5. HTTP API & CLI Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/surfaces` | List all active surfaces and message counts |
| `GET` | `/api/surfaces/capabilities` | Return A2UI supported versions, catalog IDs, 18 components, and 14 functions |
| `GET` | `/api/surfaces/{id}` | Fetch surface messages and metadata (returns empty list if not yet created) |
| `POST` | `/api/surfaces/{id}/messages` | Append or replace (`"replace": true`) messages (v0.8 / v0.9 / v0.10) |
| `POST` | `/api/surfaces/{id}/action` | Submit user action (`/actions` alias also supported) |
| `DELETE` | `/api/surfaces/{id}` | Delete surface |

```bash
aiui surface capabilities
aiui surface list
aiui surface get main --json
aiui surface push main --file surface.jsonl --replace
aiui surface clear main
aiui surface status
```

## Related pages

- [All-in-One A2UI Playground](https://ui.praison.ai/docs/a2ui/all-in-one-playground.md)
- [A2UI canvas — agent-driven UI](https://ui.praison.ai/docs/features/a2ui-canvas.md)
- [A2UI — Agent-to-User Interface](https://ui.praison.ai/docs/a2ui/overview.md)
