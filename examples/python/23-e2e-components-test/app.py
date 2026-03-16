"""E2E Test — Components, Docs, and Chat in one app.

Exercises all three rendering modes to verify no regressions:
  1. Component-based pages  (dashboard.js _components rendering)
  2. Docs/data pages        (plain dict → key-value rendering)
  3. Chat                   (echo reply via @aiui.reply)

Run:
    cd examples/python/23-e2e-components-test
    python app.py
    # Open http://localhost:8083
"""

import praisonaiui as aiui
from praisonaiui.server import create_app

aiui.set_style("dashboard")
aiui.set_pages(["chat"])


# ── 1. Components-based page ─────────────────────────────────────────

@aiui.page("all-components", title="All Components", icon="🧩", group="Components")
async def all_components():
    """Tests that all component types render via _components protocol."""
    return aiui.layout([
        aiui.header("Component Test Suite", level=1),
        aiui.separator(),

        # Cards & Metrics
        aiui.header("Cards & Metrics", level=2),
        aiui.columns([
            aiui.card("Total Users", value=1_234, footer="+12% this week"),
            aiui.card("Revenue", value="$45,600", footer="+8% this month"),
            aiui.card("Active Now", value=42),
        ]),
        aiui.columns([
            aiui.metric("Requests", value="12.3k", delta="+15%"),
            aiui.metric("Errors", value=23, delta="+3", delta_color="inverse"),
            aiui.metric("Latency", value="45ms", delta="-12ms"),
        ]),
        aiui.stat_group([
            {"label": "CPU", "value": "72%", "delta": "+5%"},
            {"label": "Memory", "value": "4.2 GB", "delta": "-200MB"},
            {"label": "Disk", "value": "120 GB", "delta": "stable"},
        ]),
        aiui.separator(),

        # Text & Display
        aiui.header("Text & Display", level=2),
        aiui.text("A simple text block."),
        aiui.markdown_text("**Bold**, *italic*, and `code` in markdown."),
        aiui.code_block("def hello():\n    print('Hello!')", language="python"),
        aiui.json_view({"status": "ok", "items": [1, 2, 3]}),
        aiui.separator(),

        # Feedback & Status
        aiui.header("Feedback & Status", level=2),
        aiui.columns([
            aiui.alert("Info message.", variant="info", title="Info"),
            aiui.alert("Success!", variant="success", title="Success"),
        ]),
        aiui.columns([
            aiui.alert("Warning.", variant="warning", title="Warning"),
            aiui.alert("Error!", variant="error", title="Error"),
        ]),
        aiui.callout("This is a helpful callout.", variant="info", title="Tip"),
        aiui.progress_bar("Upload Progress", value=73),
        aiui.columns([
            aiui.badge("New"),
            aiui.badge("Beta", variant="secondary"),
            aiui.badge("Deprecated", variant="destructive"),
            aiui.badge("v2.0", variant="outline"),
        ]),
        aiui.spinner("Loading data..."),
        aiui.empty("No results found"),
        aiui.separator(),

        # Media & Navigation
        aiui.header("Media & Navigation", level=2),
        aiui.image_display(
            "https://placehold.co/600x200/1a1a2e/6366f1?text=PraisonAI+Components",
            alt="Placeholder", caption="A sample image", width="100%",
        ),
        aiui.avatar(name="Alice Smith", fallback="AS"),
        aiui.link("Visit Documentation", href="https://docs.praison.ai", external=True),
        aiui.button_group([
            {"label": "Save", "variant": "default"},
            {"label": "Cancel", "variant": "outline"},
            {"label": "Delete", "variant": "destructive"},
        ]),
        aiui.separator(),

        # Layout
        aiui.header("Layout Components", level=2),
        aiui.divider("Section Break"),
        aiui.container([
            aiui.text("Content inside a container."),
            aiui.badge("Contained"),
        ], title="Named Container"),
        aiui.expander("Click to expand", children=[
            aiui.text("Hidden content revealed on expand."),
        ]),
        aiui.separator(),

        # Data
        aiui.header("Data Display", level=2),
        aiui.table(
            headers=["Agent", "Tasks", "Status"],
            rows=[
                ["Researcher", 15, "Active"],
                ["Writer", 8, "Idle"],
                ["Coder", 23, "Active"],
            ],
        ),
        aiui.chart("Monthly Revenue", data=[
            {"month": "Jan", "value": 4000},
            {"month": "Feb", "value": 5200},
            {"month": "Mar", "value": 4800},
        ], chart_type="bar"),
    ])


# ── 2. Form Inputs page ──────────────────────────────────────────────

@aiui.page("form-inputs", title="Form Inputs", icon="📝", group="Components")
async def form_inputs():
    """Tests all form input component types."""
    return aiui.layout([
        aiui.header("Form Input Components", level=1),
        aiui.separator(),
        aiui.columns([
            aiui.text_input("Full Name", value="Alice Smith", placeholder="Enter name"),
            aiui.number_input("Age", value=28, min_val=0, max_val=150, step=1),
        ]),
        aiui.columns([
            aiui.select_input("Country", options=["USA", "UK", "Canada"], value="USA"),
            aiui.slider_input("Volume", value=65, min_val=0, max_val=100, step=5),
        ]),
        aiui.columns([
            aiui.checkbox_input("I agree to the terms", checked=True),
            aiui.switch_input("Enable notifications", checked=False),
        ]),
        aiui.radio_input("Language", options=["Python", "JavaScript", "Go", "Rust"], value="Python"),
        aiui.textarea_input("Bio", value="Developer", placeholder="About you...", rows=3),
    ])


# ── 3. Tabs & Accordion page ─────────────────────────────────────────

@aiui.page("tabs-test", title="Tabs & Accordion", icon="📑", group="Components")
async def tabs_page():
    """Tests nested layout components."""
    return aiui.layout([
        aiui.header("Nested Layout Test", level=1),
        aiui.separator(),
        aiui.tabs([
            {
                "label": "Overview",
                "children": [
                    aiui.stat_group([
                        {"label": "Users", "value": "12.5k", "delta": "+8%"},
                        {"label": "Sessions", "value": 342, "delta": "+12%"},
                    ]),
                    aiui.text("Dashboard overview tab."),
                ],
            },
            {
                "label": "Details",
                "children": [
                    aiui.table(
                        headers=["Metric", "Value"],
                        rows=[["CPU", "45%"], ["Memory", "2.1 GB"]],
                    ),
                ],
            },
        ]),
        aiui.separator(),
        aiui.accordion([
            {"title": "What is this?", "content": "An end-to-end component test."},
            {"title": "How does it work?", "content": "Components are Python dicts rendered by dashboard.js."},
        ]),
    ])


# ── 4. Docs/Data page (plain dict — no _components) ──────────────────

@aiui.page("docs-test", title="Getting Started", icon="📚", group="Docs")
async def docs_page():
    """Tests plain dict rendering (non-component, key-value format)."""
    return {
        "title": "Getting Started with PraisonAIUI",
        "sections": [
            {"heading": "Installation", "content": "pip install praisonaiui"},
            {"heading": "First App", "content": "@aiui.reply → aiui.say()"},
            {"heading": "Dashboard", "content": "@aiui.page() for custom pages"},
        ],
    }


# ── 5. Chat echo handler ─────────────────────────────────────────────

@aiui.reply
async def on_message(message: str):
    """Echo handler — tests chat pipeline without LLM."""
    await aiui.say(f"Echo: {message}")


@aiui.starters
async def get_starters():
    return [
        {"label": "Say hello", "message": "Hello!", "icon": "👋"},
        {"label": "Test echo", "message": "This is a test", "icon": "🧪"},
    ]


@aiui.welcome
async def on_welcome():
    await aiui.say(
        "👋 **E2E Component Test** — Chat works! "
        "Check the sidebar for component pages."
    )


# ── Run ──────────────────────────────────────────────────────────────

app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8083)
