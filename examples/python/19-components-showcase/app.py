"""UI Components & Notification Center Showcase.

Interactive gallery demonstrating PraisonAIUI's modern component builders
(metrics, charts, typed tables, filter bars, kanban boards, doc viewer,
forms, feedback blocks, and real-time header notifications) in the default
React app shell.

Run:
    aiui run app.py
"""

import praisonaiui as aiui

aiui.configure(branding={"title": "UI Components Showcase"})
aiui.only_my_pages("chat")

TASKS = [
    {"id": "1", "title": "Streaming chat", "area": "Chat", "progress": 1.0, "status": "done"},
    {"id": "2", "title": "Notification Center", "area": "SDK", "progress": 1.0, "status": "done"},
    {"id": "3", "title": "YAML $ref pages", "area": "App", "progress": 0.85, "status": "active"},
]


@aiui.page("components", title="Components", icon="component", group="Showcase", badge="76")
async def components_page(params):
    area = params.get("area", "All")
    rows = [t for t in TASKS if area == "All" or t["area"] == area]

    return aiui.layout([
        aiui.header("UI Components Showcase", level=1),
        aiui.caption("Composable Python and YAML blocks rendered in the React app shell."),
        aiui.tabs([
            {
                "label": "Data & Charts",
                "children": [
                    aiui.columns([
                        aiui.metric("Active Users", value="12.4k", delta="+15%", sparkline=[9, 10, 11.4, 12.4]),
                        aiui.metric("Error Rate", value="0.12%", delta="-0.08%", delta_color="inverse"),
                        aiui.metric("p95 Latency", value=38, benchmark=100, benchmark_label="SLA ms", delta_color="inverse"),
                    ]),
                    aiui.chart(
                        "Weekly Throughput",
                        chart_type="bar",
                        data=[{"day": "Mon", "reqs": 3200}, {"day": "Tue", "reqs": 4100}, {"day": "Wed", "reqs": 4950}],
                        x="day",
                        y="reqs",
                        y_format="compact",
                    ),
                    aiui.filter_bar(
                        "components",
                        method="get",
                        defaults={"area": "All"},
                        inputs=[aiui.segmented_input("area", ["All", "Chat", "SDK", "App"], value=area)],
                    ),
                    aiui.table(
                        columns=[
                            {"key": "title", "label": "Feature", "type": "text"},
                            {"key": "area", "label": "Area", "type": "badge"},
                            {"key": "progress", "label": "Progress", "type": "progress"},
                            {"key": "status", "label": "Status", "type": "badge", "tones": {"done": "success", "active": "info"}},
                        ],
                        rows=rows,
                        searchable=True,
                        row_detail=True,
                    ),
                ],
            },
            {
                "label": "Layout & Board",
                "children": [
                    aiui.board(columns=[
                        {"title": "Planned", "cards": [aiui.card("Plugin marketplace", footer="Ecosystem")]},
                        {"title": "In Progress", "cards": [aiui.card("Docs gallery", footer="Docs")]},
                        {"title": "Shipped", "cards": [aiui.card("Notification Center", footer="SDK")]},
                    ]),
                    aiui.doc_viewer(
                        "## Markdown Doc Viewer\n\nSupports **GFM**, tables, code blocks, and an automatic TOC.",
                        title="Embedded Runbook",
                        toc=True,
                    ),
                ],
            },
            {
                "label": "Workflow & AI Blocks",
                "children": [
                    aiui.stepper(
                        [
                            {"title": "Plan", "description": "Break down task"},
                            {"title": "Retrieve", "description": "Query knowledge base"},
                            {"title": "Verify", "description": "Run tests"},
                        ],
                        active=1,
                    ),
                    aiui.columns([
                        aiui.timeline(
                            [
                                {"title": "Prompt updated", "timestamp": "09:15", "status": "info", "badge": "v2"},
                                {"title": "Eval passed (98%)", "timestamp": "09:18", "status": "success"},
                            ],
                            title="Recent Activity",
                        ),
                        aiui.tree_view(
                            [
                                {
                                    "label": "docs",
                                    "children": [
                                        {"label": "overview.md", "badge": "MD"},
                                        {"label": "quickstart.md", "badge": "MD"},
                                    ],
                                }
                            ],
                            title="Retrieved Sources",
                            default_expanded=True,
                        ),
                    ]),
                    aiui.diff_viewer(
                        "model: gpt-4o-mini\ntemperature: 0.7",
                        "model: gpt-4o-mini\ntemperature: 0.2\nmax_tokens: 1024",
                        title="Config Diff",
                        before_label="v1",
                        after_label="v2",
                    ),
                    aiui.columns([
                        aiui.copy_field("aiui run app.py", label="Quick Command"),
                        aiui.copy_field("sk-demo-0000-secret", label="API Token", secret=True),
                    ]),
                ],
            },
            {
                "label": "Inputs & Feedback",
                "children": [
                    aiui.status("Index sync", state="running", detail="Processing 120 docs", progress=72),
                    aiui.columns([
                        aiui.alert("All checks passing.", variant="success", title="Healthy"),
                        aiui.callout("Click below to push a live alert to the top bell.", variant="info", title="Notifications"),
                    ]),
                    aiui.form(
                        "components",
                        submit_label="Push Notification",
                        children=[
                            aiui.columns([
                                aiui.text_input("Alert title", name="title", value="Build complete"),
                                aiui.select_input("Type", name="variant", options=["info", "success", "warning", "error"], value="success"),
                            ]),
                            aiui.columns([
                                aiui.slider_input("Priority", name="priority", value=3, min_val=1, max_val=5),
                                aiui.rating_input("Quality Score", name="rating", value=4, max_stars=5),
                                aiui.color_picker_input("Accent", name="color", value="#6366f1"),
                            ]),
                            aiui.switch_input("Enable verbose logs", name="verbose", checked=True),
                        ],
                    ),
                ],
            },
        ]),
    ])


@aiui.register_page_action("components")
async def components_action(data: dict):
    title = data.get("title") or "Test notification"
    variant = data.get("variant") or "info"
    aiui.push_notification(
        title,
        f"Triggered from showcase (priority={data.get('priority', 3)})",
        type=variant,
        category="showcase",
        action={"label": "View Components", "page": "components"},
    )
    return {"message": f"Pushed '{title}' to Notification Center"}
