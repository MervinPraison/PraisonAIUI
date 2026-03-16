"""Component Showcase — demonstrates all 36 UI components.

Run:
    cd examples/python/19-components-showcase
    python -m praisonaiui app.py --style dashboard
"""

import praisonaiui as aiui


@aiui.page("all-components", title="All Components", icon="🧩", group="Showcase")
async def all_components():
    return aiui.layout([
        aiui.header("All 36 Components", level=1),
        aiui.separator(),

        # ── Cards & Metrics ──
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

        # ── Text & Display ──
        aiui.header("Text & Display", level=2),
        aiui.text("A simple text block for paragraphs and descriptions."),
        aiui.markdown_text("**Bold**, *italic*, and `code` in markdown."),
        aiui.code_block("def hello():\n    print('Hello, world!')", language="python"),
        aiui.json_view({"status": "ok", "items": [1, 2, 3], "nested": {"key": "value"}}),
        aiui.separator(),

        # ── Feedback & Status ──
        aiui.header("Feedback & Status", level=2),
        aiui.columns([
            aiui.alert("This is an info message.", variant="info", title="Info"),
            aiui.alert("Operation completed.", variant="success", title="Success"),
        ]),
        aiui.columns([
            aiui.alert("Please check your input.", variant="warning", title="Warning"),
            aiui.alert("Something went wrong.", variant="error", title="Error"),
        ]),
        aiui.callout("This is a helpful tip for users.", variant="info", title="Tip"),
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

        # ── Media & Navigation ──
        aiui.header("Media & Navigation", level=2),
        aiui.image_display(
            "https://placehold.co/600x200/1a1a2e/6366f1?text=PraisonAI",
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

        # ── Layout ──
        aiui.header("Layout Components", level=2),
        aiui.divider("Section Break"),
        aiui.container([
            aiui.text("Content inside a container with a title."),
            aiui.badge("Contained"),
        ], title="Named Container"),
        aiui.expander("Click to expand", children=[
            aiui.text("Hidden content revealed on expand."),
            aiui.code_block("secret = 42", language="python"),
        ]),
        aiui.separator(),

        # ── Data ──
        aiui.header("Data Display", level=2),
        aiui.table(
            headers=["Agent", "Tasks", "Status", "Last Active"],
            rows=[
                ["Researcher", 15, "Active", "2 min ago"],
                ["Writer", 8, "Idle", "1 hour ago"],
                ["Coder", 23, "Active", "Just now"],
            ],
        ),
        aiui.chart("Monthly Revenue", data=[
            {"month": "Jan", "value": 4000},
            {"month": "Feb", "value": 5200},
            {"month": "Mar", "value": 4800},
        ], chart_type="bar"),
    ])


@aiui.page("form-inputs", title="Form Inputs", icon="📝", group="Showcase")
async def form_inputs():
    return aiui.layout([
        aiui.header("Form Input Components", level=1),
        aiui.text("All 8 form input types — display-only, no server-side state."),
        aiui.separator(),

        aiui.columns([
            aiui.text_input("Full Name", value="Alice Smith", placeholder="Enter your name"),
            aiui.number_input("Age", value=28, min_val=0, max_val=150, step=1),
        ]),
        aiui.columns([
            aiui.select_input("Country", options=["USA", "UK", "Canada", "Australia"], value="USA"),
            aiui.slider_input("Volume", value=65, min_val=0, max_val=100, step=5),
        ]),
        aiui.columns([
            aiui.checkbox_input("I agree to the terms", checked=True),
            aiui.switch_input("Enable notifications", checked=False),
        ]),
        aiui.radio_input("Preferred language", options=["Python", "JavaScript", "Go", "Rust"], value="Python"),
        aiui.textarea_input(
            "Bio",
            value="I'm a developer who loves building AI tools.",
            placeholder="Tell us about yourself...",
            rows=4,
        ),
    ])


@aiui.page("layouts", title="Nested Layouts", icon="📐", group="Showcase")
async def nested_layouts():
    return aiui.layout([
        aiui.header("Nested Layout Showcase", level=1),
        aiui.separator(),

        aiui.tabs([
            {
                "label": "Overview",
                "children": [
                    aiui.stat_group([
                        {"label": "Total Users", "value": "12.5k", "delta": "+8%"},
                        {"label": "Active Sessions", "value": 342, "delta": "+12%"},
                        {"label": "Avg Response", "value": "1.2s", "delta": "-0.3s"},
                    ]),
                    aiui.text("Dashboard overview with key metrics."),
                ],
            },
            {
                "label": "Details",
                "children": [
                    aiui.container([
                        aiui.columns([
                            aiui.card("Agents Running", value=5),
                            aiui.card("Tasks Queued", value=23),
                        ]),
                        aiui.table(
                            headers=["Metric", "Value", "Trend"],
                            rows=[
                                ["CPU Usage", "45%", "↑"],
                                ["Memory", "2.1 GB", "→"],
                                ["Disk I/O", "120 MB/s", "↓"],
                            ],
                        ),
                    ], title="System Health"),
                ],
            },
            {
                "label": "Settings",
                "children": [
                    aiui.alert("Changes require restart.", variant="warning", title="Note"),
                    aiui.text_input("API Key", placeholder="sk-..."),
                    aiui.switch_input("Debug Mode"),
                    aiui.select_input("Log Level", options=["DEBUG", "INFO", "WARNING", "ERROR"], value="INFO"),
                ],
            },
        ]),

        aiui.separator(),

        aiui.accordion([
            {"title": "What is PraisonAI?", "content": "PraisonAI is a platform for building AI-powered applications with minimal code."},
            {"title": "How do components work?", "content": "Components are plain Python dicts with a 'type' key. The frontend renders them automatically."},
            {"title": "Can I nest components?", "content": "Yes! Use layout(), container(), tabs(), and accordion() to nest components arbitrarily."},
        ]),
    ])
