"""Example 29 — A2UI canvas and send_a2ui_messages integration.

Run:
    python app.py
    # Optional full Google A2UI renderer in React shell:
    cd ../../../frontend && npm install @a2ui/react @a2ui/web_core && npm run build
"""

from __future__ import annotations

import praisonaiui as aiui

aiui.set_style("dashboard")
aiui.set_branding(title="A2UI Canvas Demo", logo="🖼️")
aiui.set_chat_preview(enabled=True, surface_id="main", width="38%")
aiui.set_pages(["chat-canvas", "chat", "canvas", "agent-canvas"])


@aiui.page("agent-canvas", title="Agent Canvas", icon="🖼️", group="A2UI")
async def agent_canvas_page():
    return {"_surface": {"id": "main", "messages": []}}


@aiui.surface_action("main")
async def on_surface_action(action: dict):
    return {"received": action}


def _build_assistant_agent():
    from praisonaiagents import Agent
    from praisonaiagents.tools.decorator import tool
    from praisonaiagents.tools.a2ui_tools import send_a2ui_messages as sdk_send_a2ui

    from praisonaiui.a2ui_utils import coerce_a2ui_tool_messages

    @tool
    def send_a2ui_messages(messages):
        """
        Push A2UI v0.9 UI to the canvas. Always call this for buttons, layouts, forms.

        Example:
            send_a2ui_messages(messages=[
              {"createSurface": {"surfaceId": "main", "catalogId": "basic"}},
              {"updateComponents": {"components": [
                {"component": "Text", "text": {"literal": "Mobile App Header"}},
                {"component": "Button", "text": {"literal": "Submit"},
                 "action": {"name": "handleSubmit"}},
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


def create_app():
    try:
        agent = _build_assistant_agent()
        aiui.register_agent("assistant", agent)
    except ImportError:
        pass

    from praisonaiui.server import create_app as _create_app

    return _create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(create_app(), host="127.0.0.1", port=8099)
