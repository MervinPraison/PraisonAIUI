"""Example 30 — Complete A2UI v0.9 Canvas, Multi-Surface & Interactive Playground.

Demonstrates:
  - Split Chat + Canvas preview (``chat-canvas``)
  - Full-page multi-surface workspace (``canvas``)
  - Single-page multi-surface & all-in-one gallery (``agent-canvas``)
  - Separate settings & capabilities page (``a2ui-settings``)
  - Reactive data binding (``updateDataModel`` + ``{path}``) & ``@aiui.surface_action``
  - Live PraisonAI agent integration with ``send_a2ui_messages``

Run:
    python app.py
"""

from __future__ import annotations

import praisonaiui as aiui

aiui.set_branding(title="A2UI Studio")
aiui.set_chat_preview(enabled=True, surface_id="main", width="40%")
aiui.set_pages(["chat-canvas", "chat", "canvas", "agent-canvas", "a2ui-settings"])


def _demo_surface(counter: int = 1, status: str = "Ready") -> list[dict]:
    """Build an interactive A2UI v0.9 surface using the Basic Catalog + data binding."""
    return aiui.a2ui_surface(
        surface_id="main",
        theme={"primaryColor": "#2563eb"},
        send_data_model=True,
        components=[
            {
                "id": "root",
                "component": "Column",
                "children": ["header", "summary-card", "form-card", "actions-row"],
            },
            {"id": "header", "component": "Text", "text": {"path": "/title"}, "variant": "h2"},
            {"id": "summary-card", "component": "Card", "child": "summary-col"},
            {
                "id": "summary-col",
                "component": "Column",
                "children": ["status-line", "divider-1", "counter-line"],
            },
            {"id": "status-line", "component": "Text", "text": {"path": "/status"}},
            {"id": "divider-1", "component": "Divider"},
            {"id": "counter-line", "component": "Text", "text": {"path": "/counterLabel"}, "variant": "caption"},
            {"id": "form-card", "component": "Card", "child": "form-col"},
            {
                "id": "form-col",
                "component": "Column",
                "children": ["name-field", "notify-check", "priority-slider"],
            },
            {
                "id": "name-field",
                "component": "TextField",
                "label": "Project Name",
                "value": {"path": "/form/name"},
            },
            {
                "id": "notify-check",
                "component": "CheckBox",
                "label": "Send email updates",
                "value": {"path": "/form/notify"},
            },
            {
                "id": "priority-slider",
                "component": "Slider",
                "label": "Priority (1-10)",
                "min": 1,
                "max": 10,
                "value": {"path": "/form/priority"},
            },
            {
                "id": "actions-row",
                "component": "Row",
                "children": ["btn-inc", "btn-reset"],
            },
            {"id": "btn-inc-label", "component": "Text", "text": "Run Step"},
            {
                "id": "btn-inc",
                "component": "Button",
                "child": "btn-inc-label",
                "variant": "primary",
                "action": {"event": {"name": "increment", "context": {"step": {"path": "/counter"}}}},
            },
            {"id": "btn-reset-label", "component": "Text", "text": "Reset"},
            {
                "id": "btn-reset",
                "component": "Button",
                "child": "btn-reset-label",
                "action": {"event": {"name": "reset", "context": {}}},
            },
        ],
        data={
            "title": "A2UI Interactive Workspace",
            "status": f"Status: {status}",
            "counter": counter,
            "counterLabel": f"Completed steps: {counter}",
            "form": {"name": "Launch Plan", "notify": True, "priority": 7},
        },
    )


_demo_state = {"counter": 1}


@aiui.page("agent-canvas", title="Agent Canvas", icon="🖼️", group="A2UI")
async def agent_canvas_page():
    """Single-page A2UI surface seeded with the interactive Basic Catalog demo."""
    return {"_surface": {"id": "main", "messages": _demo_surface(_demo_state["counter"])}}


@aiui.page("a2ui-settings", title="A2UI Settings & Catalog", icon="settings", group="A2UI")
async def a2ui_settings_page():
    """Inspect A2UI client capabilities, supported versions, and Basic Catalog inventory."""
    caps = aiui.a2ui_client_capabilities()
    return aiui.layout(
        [
            aiui.header("A2UI Capabilities & Settings", level=2),
            aiui.caption("Supported protocol versions, catalogs, and client-side functions."),
            aiui.columns(
                [
                    aiui.metric("Default Version", value=caps["version"]),
                    aiui.metric("Supported Specs", value=", ".join(caps["supportedVersions"])),
                    aiui.metric("Basic Components", value=str(len(caps["components"]))),
                    aiui.metric("Client Functions", value=str(len(caps["functions"]))),
                ]
            ),
            aiui.container(
                [aiui.text(", ".join(caps["components"]))],
                title="Supported Basic Catalog Components (18)",
            ),
            aiui.container(
                [aiui.text(", ".join(caps["functions"]))],
                title="Client-Side Functions (14)",
            ),
            aiui.container([aiui.json_view(caps)], title="GET /api/surfaces/capabilities"),
        ]
    )


@aiui.surface_action("main")
async def on_surface_action(action: dict):
    """Handle clicks from the A2UI surface and push a live data-model update."""
    name = action.get("action")
    if name == "increment":
        _demo_state["counter"] += 1
        await aiui.push_surface("main", _demo_surface(_demo_state["counter"], status="Updated via action"), replace=True)
    elif name == "reset":
        _demo_state["counter"] = 1
        await aiui.push_surface("main", _demo_surface(1, status="Reset"), replace=True)
    return {"received": action, "counter": _demo_state["counter"]}


def _build_assistant_agent():
    from praisonaiagents import Agent
    from praisonaiagents.tools.a2ui_tools import send_a2ui_messages as sdk_send_a2ui
    from praisonaiagents.tools.decorator import tool

    from praisonaiui.a2ui_utils import coerce_a2ui_tool_messages

    @tool
    def send_a2ui_messages(messages):
        """
        Push A2UI v0.9 UI to the canvas. Always call this for buttons, layouts, forms.

        Example:
            send_a2ui_messages(messages=[
              {"createSurface": {"surfaceId": "main", "catalogId": "basic"}},
              {"updateComponents": {"components": [
                {"id": "root", "component": "Column", "children": ["t1", "b1"]},
                {"id": "t1", "component": "Text", "text": "Mobile App Header", "variant": "h2"},
                {"id": "b1", "component": "Button", "text": "Submit", "action": {"event": {"name": "handleSubmit"}}},
              ]}},
            ])
        """
        coerced = coerce_a2ui_tool_messages(messages, surface_id="main")
        return sdk_send_a2ui(messages=coerced)

    role = (
        "You are a UI builder. For ANY UI request you MUST call send_a2ui_messages "
        "before replying — never claim UI was created without a successful tool call. "
        "Use surface id 'main'. Prefer Column layouts for mobile app UIs."
    )
    try:
        from praisonaiagents.ui.a2ui.adapter import generate_a2ui_system_prompt

        instructions = generate_a2ui_system_prompt(
            role_description=role,
            workflow_description="Call send_a2ui_messages with valid A2UI JSON, then briefly confirm.",
            ui_description="Dashboard canvas on surface main.",
        )
    except ImportError:
        instructions = role

    return Agent(name="assistant", instructions=instructions, tools=[send_a2ui_messages])


def _register_assistant() -> None:
    """Register at import time so ``aiui run`` and ``python app.py`` both see it."""
    try:
        aiui.register_agent("assistant", _build_assistant_agent())
    except ImportError:
        pass


_register_assistant()


def create_app():
    from praisonaiui.server import create_app as _create_app

    return _create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(create_app(), host="127.0.0.1", port=8099)
