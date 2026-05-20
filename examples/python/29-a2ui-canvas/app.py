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


def create_app():
    try:
        from praisonaiagents import Agent
        from praisonaiagents.tools.a2ui_tools import send_a2ui_messages

        agent = Agent(
            name="assistant",
            instructions=(
                "You are a helpful assistant. When asked to show UI, "
                "use send_a2ui_messages with A2UI v0.9 JSON."
            ),
            tools=[send_a2ui_messages],
        )
        aiui.register_agent("assistant", agent)
    except ImportError:
        pass

    from praisonaiui.server import create_app as _create_app

    return _create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(create_app(), host="127.0.0.1", port=8099)
