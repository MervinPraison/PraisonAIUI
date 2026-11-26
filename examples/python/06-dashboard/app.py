"""App & Dashboard Pages — Metrics, charts, typed tables, docs, and notifications.

Runs in the modern React app shell (default). Add ``--style dashboard`` only if
you specifically want the legacy vanilla dashboard.

Run:
    aiui run app.py
"""

import praisonaiui as aiui

aiui.configure(branding={"title": "Analytics Hub"})
aiui.only_my_pages("chat")

SERVICES = [
    {"name": "Chat Gateway", "requests": 142_000, "p95_ms": 18, "status": "healthy"},
    {"name": "Vector Search", "requests": 58_400, "p95_ms": 42, "status": "healthy"},
    {"name": "Batch Sync", "requests": 12_100, "p95_ms": 95, "status": "warning"},
]


@aiui.reply
async def on_message(message: str):
    await aiui.say(f"Analytics assistant received: **{message}**")


@aiui.page(
    "metrics",
    title="Metrics",
    icon="bar-chart-2",
    group="Analytics",
    description="Live KPIs, traffic trend, and service health",
    badge=lambda: len(SERVICES),
)
async def metrics_page(params):
    status_filter = params.get("status", "all")
    rows = [s for s in SERVICES if status_filter == "all" or s["status"] == status_filter]

    return aiui.layout([
        aiui.columns([
            aiui.metric("Requests (7d)", value="212.5k", delta="+14%", sparkline=[160, 175, 192, 212]),
            aiui.metric("Avg Latency", value="28 ms", delta="-6 ms", delta_color="inverse"),
            aiui.metric("Uptime", value="99.98%", caption="last 30 days"),
        ]),
        aiui.chart(
            "Daily Requests",
            chart_type="line",
            data=[
                {"day": "Mon", "requests": 28_000},
                {"day": "Tue", "requests": 31_400},
                {"day": "Wed", "requests": 34_900},
                {"day": "Thu", "requests": 38_200},
            ],
            x="day",
            y="requests",
            y_format="compact",
        ),
        aiui.filter_bar(
            "metrics",
            method="get",
            defaults={"status": "all"},
            inputs=[
                aiui.segmented_input("status", ["all", "healthy", "warning"], value=status_filter),
            ],
        ),
        aiui.table(
            columns=[
                {"key": "name", "label": "Service", "type": "text"},
                {"key": "requests", "label": "Requests", "type": "number", "format": "compact"},
                {"key": "p95_ms", "label": "p95 (ms)", "type": "number", "tone_above": [80, "warning"]},
                {"key": "status", "label": "Status", "type": "badge", "tones": {"healthy": "success", "warning": "warning"}},
            ],
            rows=rows,
            searchable=True,
            row_detail=True,
        ),
        aiui.button_group([{"label": "Send Test Alert", "action": "alert", "variant": "outline"}]),
    ])


@aiui.register_page_action("metrics")
async def metrics_action(data: dict):
    if data.get("action") == "alert":
        aiui.push_notification(
            "Metrics snapshot shared",
            "All core services are within SLA.",
            type="success",
            category="analytics",
            action={"label": "Open Metrics", "page": "metrics"},
        )
        return {"message": "Notification pushed to header bell"}
    return {}


@aiui.page("runbook", title="Runbook", icon="book-open", group="Docs", order=20)
async def runbook_page():
    return aiui.layout([
        aiui.doc_viewer(
            "# Quick Runbook\n\n## Install\n`pip install aiui`\n\n## Run\n`aiui run app.py`",
            title="Operations Guide",
            toc=True,
        )
    ])
