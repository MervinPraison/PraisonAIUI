"""Component Showcase — demonstrates all 54 UI components.

Run:
    cd examples/python/19-components-showcase
    python -m praisonaiui app.py --style dashboard
"""

import praisonaiui as aiui


@aiui.page("all-components", title="All Components", icon="🧩", group="Showcase")
async def all_components():
    return aiui.layout([
        aiui.header("All 54 Components", level=1),
        aiui.caption("A comprehensive showcase of every UI component available."),
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
        aiui.key_value_list([
            {"label": "Version", "value": "2.1.0"},
            {"label": "Environment", "value": "Production"},
            {"label": "Region", "value": "us-east-1"},
            {"label": "Uptime", "value": "99.97%"},
        ], title="System Info"),
        aiui.separator(),

        # ── Text & Display ──
        aiui.header("Text & Display", level=2),
        aiui.text("A simple text block for paragraphs and descriptions."),
        aiui.caption("This is a caption — small, muted text for annotations."),
        aiui.markdown_text("**Bold**, *italic*, and `code` in markdown."),
        aiui.code_block("def hello():\n    print('Hello, world!')", language="python"),
        aiui.json_view({"status": "ok", "items": [1, 2, 3], "nested": {"key": "value"}}),
        aiui.html_embed('<div style="padding:12px;background:#1e293b;border-radius:8px;color:#94a3b8">Custom HTML embed — any trusted content works here.</div>'),
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
        aiui.toast("Changes saved successfully!", variant="success"),
        aiui.progress_bar("Upload Progress", value=73),
        aiui.columns([
            aiui.badge("New"),
            aiui.badge("Beta", variant="secondary"),
            aiui.badge("Deprecated", variant="destructive"),
            aiui.badge("v2.0", variant="outline"),
        ]),
        aiui.spinner("Loading data..."),
        aiui.empty("No results found"),
        aiui.columns([
            aiui.skeleton(variant="text"),
            aiui.skeleton(variant="card", height="80px"),
            aiui.skeleton(variant="avatar"),
        ]),
        aiui.separator(),

        # ── Media & Navigation ──
        aiui.header("Media & Navigation", level=2),
        aiui.image_display(
            "https://placehold.co/600x200/1a1a2e/6366f1?text=PraisonAI",
            alt="Placeholder", caption="A sample image", width="100%",
        ),
        aiui.gallery([
            {"src": "https://placehold.co/200/1a1a2e/6366f1?text=1", "alt": "Item 1", "caption": "First"},
            {"src": "https://placehold.co/200/1a1a2e/22c55e?text=2", "alt": "Item 2", "caption": "Second"},
            {"src": "https://placehold.co/200/1a1a2e/ef4444?text=3", "alt": "Item 3", "caption": "Third"},
            {"src": "https://placehold.co/200/1a1a2e/eab308?text=4", "alt": "Item 4", "caption": "Fourth"},
        ]),
        aiui.audio_player("https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"),
        aiui.video_player("https://www.w3schools.com/html/mov_bbb.mp4", poster="https://placehold.co/600x300/1a1a2e/6366f1?text=Video"),
        aiui.avatar(name="Alice Smith", fallback="AS"),
        aiui.link("Visit Documentation", href="https://docs.praison.ai", external=True),
        aiui.file_download("Download Report", href="/api/report.csv", filename="report.csv"),
        aiui.breadcrumb([
            {"label": "Home", "href": "/"},
            {"label": "Dashboard", "href": "/dashboard"},
            {"label": "Analytics"},
        ]),
        aiui.button_group([
            {"label": "Save", "variant": "default"},
            {"label": "Cancel", "variant": "outline"},
            {"label": "Delete", "variant": "destructive"},
        ]),
        aiui.pagination(total=250, page=3, per_page=10),
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
        aiui.dialog("Settings Dialog", children=[
            aiui.text_input("API Key", placeholder="sk-..."),
            aiui.switch_input("Debug Mode"),
        ], description="Configure your application settings."),
        aiui.tooltip_wrap(aiui.badge("Hover me"), content="This is a tooltip!"),
        aiui.popover(
            aiui.badge("Click for details"),
            children=[
                aiui.text("Popover content with nested components."),
                aiui.badge("Inside popover", variant="secondary"),
            ],
        ),
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
        aiui.caption("All 12 form input types — display-only, no server-side state."),
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
        aiui.separator(),

        aiui.header("New Input Types", level=2),
        aiui.multiselect_input("Skills", options=["Python", "TypeScript", "Go", "Rust", "SQL"], value=["Python", "TypeScript"]),
        aiui.columns([
            aiui.date_input("Start Date", value="2026-03-16"),
            aiui.time_input("Meeting Time", value="14:30"),
        ]),
        aiui.color_picker_input("Theme Color", value="#6366f1"),
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
                    aiui.key_value_list([
                        {"label": "Deployment", "value": "v2.1.0"},
                        {"label": "Last Deploy", "value": "2 hours ago"},
                        {"label": "Status", "value": "Healthy"},
                    ], title="Quick Info"),
                ],
            },
            {
                "label": "Details",
                "children": [
                    aiui.breadcrumb([
                        {"label": "Dashboard", "href": "/"},
                        {"label": "System", "href": "/system"},
                        {"label": "Health"},
                    ]),
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
                    aiui.pagination(total=150, page=1, per_page=10),
                ],
            },
            {
                "label": "Settings",
                "children": [
                    aiui.alert("Changes require restart.", variant="warning", title="Note"),
                    aiui.text_input("API Key", placeholder="sk-..."),
                    aiui.switch_input("Debug Mode"),
                    aiui.select_input("Log Level", options=["DEBUG", "INFO", "WARNING", "ERROR"], value="INFO"),
                    aiui.color_picker_input("Accent Color", value="#6366f1"),
                    aiui.dialog("Advanced Settings", children=[
                        aiui.number_input("Max Workers", value=4, min_val=1, max_val=32),
                        aiui.slider_input("Timeout (s)", value=30, min_val=5, max_val=300),
                        aiui.checkbox_input("Enable experimental features"),
                    ], description="These settings require expertise."),
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
