"""Example 28 — Full Extensibility Showcase.

Demonstrates EVERY extension point in PraisonAIUI:

1. `@aiui.page()`           — custom dashboard page
2. `aiui.form_action()`     — form with inputs that POSTs to the server
3. `@aiui.register_page_action()` — server-side form submission handler
4. `window.aiui.registerView()`      — client-side custom view
5. `window.aiui.registerComponent()` — client-side custom component renderer
6. Custom component dict type (`timeline`) — any `{"type": "..."}` is rendered
7. All UI component categories (metric, card, table, chart, form inputs, etc.)
8. Theme + branding + custom CSS
9. All standard endpoints: /api/health, /api/pages, /api/pages/{id}/data,
   /api/pages/{id}/action, /api/features, /api/theme, /api/overview

Run:
    python app.py
    # or
    aiui run app.py

Then open http://localhost:8082
"""

from __future__ import annotations

from pathlib import Path

import praisonaiui as aiui


# ── 1. Configure look & feel ────────────────────────────────────────
aiui.set_style("dashboard")
aiui.set_branding(title="Full Extensibility Demo", logo="🧩")
aiui.set_theme(preset="indigo", dark_mode=True, radius="md")
aiui.set_brand_color("#818cf8")

# ── 1b. Load the client-side plugin.js via the new Python API ──────
# This replaces the old "paste into DevTools console" workaround.
aiui.set_custom_js(Path(__file__).parent / "plugin.js")

# ── 1c. Register a JSON schema for the custom `timeline` component ──
# Client validators, codegen, and /api/components/schemas will see this.
aiui.register_component_schema("timeline", {
    "type": "object",
    "required": ["type", "events"],
    "properties": {
        "type": {"const": "timeline"},
        "events": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["time", "label"],
                "properties": {
                    "time": {"type": "string"},
                    "label": {"type": "string"},
                    "icon": {"type": "string"},
                },
            },
        },
    },
})


# ── 2. In-memory "database" for the form action demo ────────────────
_contacts: list[dict] = []


# ── 3. Overview page using the component API ───────────────────────
@aiui.page("demo-overview", title="Overview", icon="📊", group="Demo")
async def overview():
    return aiui.layout([
        aiui.header("Full Extensibility Demo", level=1),
        aiui.markdown_text(
            content="<p>This page showcases every <b>extension point</b> "
                    "that PraisonAIUI exposes to users.</p>"
        ),
        aiui.columns([
            aiui.card("Contacts", value=str(len(_contacts)), footer="Saved via form action"),
            aiui.card("Components", value="48", footer="Built-in component types"),
            aiui.card("Extensions", value="3", footer="Ways to extend the UI"),
        ]),
        aiui.callout(
            title="Try it out",
            content="Visit the other pages to see each extension in action.",
            variant="info",
        ),
    ])


# ── 4. Form action page — form_action + register_page_action ────────
@aiui.page("contact-form", title="Contact Form", icon="📝", group="Demo")
async def contact_form():
    return aiui.layout([
        aiui.header("Add a Contact", level=2),
        aiui.text(
            "Submitting this form calls POST /api/pages/contact-form/action, "
            "which is handled by @aiui.register_page_action(\"contact-form\")."
        ),
        aiui.form_action(
            "contact-form",
            submit_label="Save Contact",
            children=[
                aiui.text_input("Name", placeholder="Jane Doe", name="name"),
                aiui.text_input("Email", placeholder="jane@example.com", name="email"),
                aiui.number_input("Age", value=30, min_val=0, max_val=120, name="age"),
                aiui.select_input("Role", options=["Engineer", "Designer", "PM"], name="role"),
                aiui.checkbox_input("Subscribe to newsletter", checked=True, name="subscribe"),
                aiui.textarea_input("Notes", placeholder="Anything else?", rows=3, name="notes"),
            ],
        ),
        aiui.separator(),
        aiui.header("Saved Contacts", level=3),
        aiui.table(
            headers=["Name", "Email", "Age", "Role", "Subscribe"],
            rows=[
                [c.get("name", ""), c.get("email", ""), c.get("age", ""),
                 c.get("role", ""), "✓" if c.get("subscribe") else "–"]
                for c in _contacts
            ] or [["—", "—", "—", "—", "—"]],
        ),
    ])


@aiui.register_page_action("contact-form")
async def handle_contact_submit(data: dict) -> dict:
    """Server-side handler for the contact form POST."""
    _contacts.append(data)
    return {"status": "saved", "count": len(_contacts), "received": data}


# ── 5. Custom component page — demonstrates `timeline` type ─────────
@aiui.page("timeline-demo", title="Custom Component", icon="🕒", group="Demo")
async def timeline_demo():
    # This `timeline` type isn't built in — a custom client-side renderer
    # (see templates/index.html below) handles it via registerComponent().
    return aiui.layout([
        aiui.header("Custom Component: Timeline", level=2),
        aiui.text(
            "The `timeline` component below has NO built-in renderer. "
            "It's registered client-side via window.aiui.registerComponent(). "
            "Open Overview → view HTML to see the extension code."
        ),
        {
            "type": "timeline",
            "events": [
                {"time": "09:00", "label": "Kickoff meeting", "icon": "🎯"},
                {"time": "10:30", "label": "Design review",    "icon": "🎨"},
                {"time": "13:00", "label": "Lunch",            "icon": "🍽️"},
                {"time": "15:00", "label": "Code review",      "icon": "💻"},
                {"time": "17:00", "label": "Deploy to prod",   "icon": "🚀"},
            ],
        },
    ])


# ── 6. All-components showcase ─────────────────────────────────────
@aiui.page("components-showcase", title="All Components", icon="🎨", group="Demo")
async def showcase():
    return aiui.layout([
        aiui.header("Core Components", level=2),
        aiui.columns([
            aiui.metric(label="Revenue", value="$12,340", delta="+8%"),
            aiui.metric(label="Users",   value="1,204",   delta="+3%"),
            aiui.metric(label="Uptime",  value="99.9%",   delta="0%"),
        ]),
        aiui.chart(data=[10, 20, 15, 30, 25, 40, 35], type="line"),
        aiui.progress_bar(value=75, label="Completion"),

        aiui.header("Alerts & Badges", level=2),
        aiui.alert("This is an informational alert.", variant="info"),
        aiui.alert("Something went wrong!", variant="error"),
        aiui.badge("new", variant="default"),
        aiui.badge("draft", variant="secondary"),

        aiui.header("Layout", level=2),
        aiui.tabs(tabs=[
            {"label": "Tab 1", "children": [aiui.text("Content of tab 1.")]},
            {"label": "Tab 2", "children": [aiui.text("Content of tab 2.")]},
        ]),
        aiui.accordion(items=[
            {"title": "What is PraisonAIUI?",
             "children": [aiui.text("A protocol-driven UI framework for AI apps.")]},
            {"title": "How do I extend it?",
             "children": [aiui.text("See the Contact Form and Timeline pages.")]},
        ]),

        aiui.header("Code & Data", level=2),
        aiui.code_block(
            language="python",
            code="import praisonaiui as aiui\n\n@aiui.page('hello')\nasync def hello():\n    return aiui.layout([aiui.text('Hi!')])",
        ),
        aiui.json_view(data={"name": "PraisonAIUI", "components": 48}),
    ])


# ── 7. Register a page that will be rendered entirely by the client ──
# The view runs in the browser via window.aiui.registerView('custom-view', ...).
# When plugin.js is loaded, registerView takes priority over this server-side
# fallback. If plugin.js is NOT loaded, the user sees a helpful message.
@aiui.page("custom-view", title="Client-Only View", icon="⚡", group="Demo")
async def custom_view_fallback():
    return aiui.layout([
        aiui.callout(
            title="Plugin not loaded",
            content=(
                "This page is meant to be rendered client-side. "
                "Open DevTools → Console and paste the contents of "
                "plugin.js (in this example folder) to "
                "activate the custom view."
            ),
            variant="warning",
        ),
    ])


if __name__ == "__main__":
    import uvicorn
    from praisonaiui.server import create_app
    app = create_app()
    uvicorn.run(app, host="0.0.0.0", port=8082)
