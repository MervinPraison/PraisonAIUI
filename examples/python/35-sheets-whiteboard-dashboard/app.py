"""Example 35: Interactive Spreadsheets, Whiteboards & KPI Dashboard.

Demonstrates how PraisonAIUI combines live formula Spreadsheets (`aiui.sheet`),
draggable Whiteboards (`aiui.whiteboard`), KPI Charts, Notifications, and Chat
+ Split Artifacts Canvas fences in one self-hosted workspace (zero API key).

Run with:
    aiui run app.py --port 8080
"""

from __future__ import annotations

import json

import praisonaiui as aiui

BUDGET_SHEET = aiui.sheet(
    "Q4 SaaS Operating Plan",
    id="q4-operating-plan",
    tabs=[
        {
            "name": "Q4 Budget",
            "grid": [
                ["Department", "Budget ($)", "Actual ($)", "Variance ($)", "Status"],
                ["Engineering", 140000, 132500, "=B2-C2", '=IF(D2>=0, "Under", "Over")'],
                ["Infrastructure", 48000, 51200, "=B3-C3", '=IF(D3>=0, "Under", "Over")'],
                ["Marketing", 62000, 58400, "=B4-C4", '=IF(D4>=0, "Under", "Over")'],
                ["Customer Success", 36000, 34100, "=B5-C5", '=IF(D5>=0, "Under", "Over")'],
                ["Total", "=SUM(B2:B5)", "=SUM(C2:C5)", "=SUM(D2:D5)", '=IF(D6>=0, "On Track", "Review")'],
                ["Average", "=ROUND(AVERAGE(B2:B5), 0)", "=ROUND(AVERAGE(C2:C5), 0)", "=ROUND(AVERAGE(D2:D5), 0)", ""],
            ],
        },
        {
            "name": "Headcount Plan",
            "grid": [
                ["Team", "Current", "Q4 Target", "Open Roles"],
                ["Core Platform", 8, 10, "=C2-B2"],
                ["Applied AI", 6, 9, "=C3-B3"],
                ["Design & DX", 4, 5, "=C4-B4"],
                ["Total", "=SUM(B2:B4)", "=SUM(C2:C4)", "=SUM(D2:D4)"],
            ],
        },
    ],
)

LAUNCH_WHITEBOARD = aiui.whiteboard(
    title="Product Launch Architecture",
    id="launch-architecture",
    items=[
        {"id": "intake", "type": "sticky", "text": "User Prompt\n& CSV / Docs", "x": 28, "y": 40, "w": 160, "h": 82, "color": "yellow"},
        {"id": "analyst", "type": "sticky", "text": "Analyst Agent\nBuilds Live Sheet", "x": 244, "y": 40, "w": 176, "h": 82, "color": "blue"},
        {"id": "review", "type": "shape", "shape": "ellipse", "text": "Human Approval", "x": 476, "y": 44, "w": 150, "h": 74, "color": "amber"},
        {"id": "studio", "type": "sticky", "text": "Studio Dashboard\n+ Notification", "x": 244, "y": 174, "w": 176, "h": 82, "color": "green"},
        {"type": "arrow", "from": "intake", "to": "analyst", "label": "context"},
        {"type": "arrow", "from": "analyst", "to": "review", "label": "verify"},
        {"type": "arrow", "from": "review", "to": "studio", "label": "publish"},
    ],
)

aiui.set_branding(title="PraisonAIUI Studio")


@aiui.starters
async def get_starters():
    return [
        {"label": "Generate Q4 Budget Sheet", "message": "Generate a Q4 budget spreadsheet with live formulas"},
        {"label": "Create Launch Whiteboard", "message": "Create a product launch architecture whiteboard"},
        {"label": "Full Executive Studio", "message": "Build an executive summary with sheet and whiteboard"},
    ]


@aiui.reply
async def on_message(message):
    text = (message.text if hasattr(message, "text") else str(message)).lower()

    if "whiteboard" in text and "sheet" not in text:
        fence = f"```whiteboard\n{json.dumps(LAUNCH_WHITEBOARD)}\n```"
        await aiui.say(f"Here is an interactive architecture whiteboard (drag stickies, click **+ Sticky**, zoom, or export SVG):\n\n{fence}")
        return

    if "executive" in text or ("sheet" in text and "whiteboard" in text):
        sheet_fence = f"```sheet\n{json.dumps(BUDGET_SHEET)}\n```"
        board_fence = f"```whiteboard\n{json.dumps(LAUNCH_WHITEBOARD)}\n```"
        aiui.push_notification(
            "Studio artifacts updated",
            body="Generated Q4 Operating Plan spreadsheet and Product Launch whiteboard.",
            level="success",
            source="studio",
            page="studio",
        )
        await aiui.say(
            "Generated both live artifacts and pushed a notification to the bell:\n\n"
            f"{sheet_fence}\n\n{board_fence}"
        )
        return

    sheet_fence = f"```sheet\n{json.dumps(BUDGET_SHEET)}\n```"
    await aiui.say(
        "Here is your live Q4 budget workbook — double-click any cell to edit values or formulas (`=SUM`, `=AVERAGE`, `=IF`), switch tabs, filter rows, or export CSV/JSON:\n\n"
        f"{sheet_fence}"
    )


@aiui.page("studio", title="Studio Dashboard", icon="table", group="Workspace")
async def studio_dashboard():
    return aiui.layout([
        aiui.header("Executive Studio: Sheets + Whiteboard + KPIs"),
        aiui.caption("Double-click spreadsheet cells to recalculate formulas live; drag whiteboard stickies to rearrange."),
        aiui.columns([
            aiui.metric("Q4 Budget", value="$286k", delta="+4.2%", sparkline=[240, 255, 272, 286]),
            aiui.metric("Actual Spend", value="$276.2k", delta="-3.4% under", delta_color="inverse"),
            aiui.metric("Open Roles", value="6", delta="3 teams", benchmark=10, benchmark_label="Q4 cap"),
        ]),
        aiui.chart(
            "Budget vs Actual by Department ($k)",
            chart_type="bar",
            data=[
                {"dept": "Engineering", "Budget": 140, "Actual": 132.5},
                {"dept": "Infra", "Budget": 48, "Actual": 51.2},
                {"dept": "Marketing", "Budget": 62, "Actual": 58.4},
                {"dept": "CS", "Budget": 36, "Actual": 34.1},
            ],
            x="dept",
            y=["Budget", "Actual"],
        ),
        BUDGET_SHEET,
        LAUNCH_WHITEBOARD,
    ])
