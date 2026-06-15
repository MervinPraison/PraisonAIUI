# Example 28 — Full Extensibility Showcase

Demonstrates **every** extension point in PraisonAIUI.

## Extension Points Demonstrated

| # | Extension | Where | Side |
|---|-----------|-------|------|
| 1 | `@aiui.page()` | `app.py` | Server |
| 2 | `aiui.form_action()` | `app.py` | Server (returns dict) |
| 3 | `@aiui.register_page_action()` | `app.py` | Server (form handler) |
| 4 | `window.aiui.registerView()` | `plugin.js` | Client |
| 5 | `window.aiui.registerComponent()` | `plugin.js` | Client |
| 6 | Custom component type (`timeline`) | `app.py` + `plugin.js` | Both |
| 7 | Theme / branding / brand color | `app.py` | Server |

## Endpoints Exercised

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/health` | Server health check |
| `GET` | `/api/pages` | List all registered pages |
| `GET` | `/api/pages/{id}/data` | Get a page's rendered components |
| `POST` | `/api/pages/{id}/action` | Submit a form-action from `aiui.form_action()` |
| `GET` | `/api/features` | List all registered feature protocols |
| `GET` | `/api/theme` | Get current theme variables |
| `GET` | `/api/overview` | Dashboard statistics |

## Run

```bash
python app.py
# Then visit: http://localhost:8082
```

## Testing the custom component + custom view

The `timeline` component and the `custom-view` page are client-side extensions.
Load `plugin.js` into the page:

1. Open http://localhost:8082 in the browser
2. Open DevTools → Console
3. Paste the full contents of `plugin.js` and press Enter
4. Navigate to **Custom Component** → the timeline now renders as a styled list
5. Navigate to **Client-Only View** → a JS-rendered clock appears

> **Gap**: There is currently no Python API to inject client-side JS from
> `app.py`. A proposed `aiui.set_custom_js(path)` would close this gap —
> see the `docs/features/how-to-add-a-feature.md` guide.

## Testing the form action

1. Navigate to **Contact Form**
2. Fill in the form (Name / Email / Age / Role / Newsletter / Notes)
3. Click **Save Contact**
4. The form POSTs to `/api/pages/contact-form/action`
5. The server-side `@aiui.register_page_action("contact-form")` handler
   appends the contact to an in-memory list and returns `{"status": "saved", ...}`
6. Reload the page — the contact appears in the table below the form

## Curl the endpoints

```bash
# Health
curl http://localhost:8082/api/health

# All pages
curl http://localhost:8082/api/pages

# Overview page data
curl http://localhost:8082/api/pages/demo-overview/data

# Submit the contact form
curl -X POST http://localhost:8082/api/pages/contact-form/action \
     -H "Content-Type: application/json" \
     -d '{"Name":"Jane","Email":"jane@example.com","Age":30,"Role":"PM"}'

# Features
curl http://localhost:8082/api/features

# Theme
curl http://localhost:8082/api/theme
```
