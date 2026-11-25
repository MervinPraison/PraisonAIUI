"""Whiteboard and sheet tools in the PraisonAI chat.

Run from PraisonAIUI, with the SDK tree that contains these tools:

    $env:PYTHONPATH = "..\\..\\PraisonAI-v4.7.11\\src\\praisonai-agents"
    aiui run examples/python/32-whiteboard-sheet/app.py --port 8855

Open http://127.0.0.1:8855/chat and ask for a whiteboard and a sheet.
"""

from __future__ import annotations

import praisonaiui as aiui

aiui.set_style("app")
aiui.set_pages(["chat", "chat-canvas"])


def _build_assistant_agent():
    from praisonaiagents import Agent
    from praisonaiagents.tools import excalidraw_create, sheet_create, whiteboard_create

    return Agent(
        name="assistant",
        instructions=(
            "You can create sticky whiteboards, spreadsheets, and Excalidraw diagrams. "
            "Use excalidraw_create for a hand-drawn sketch or flow, not whiteboard_create. "
            "After a tool call, paste its markdown field into the reply unchanged."
        ),
        tools=[whiteboard_create, sheet_create, excalidraw_create],
    )


def _register_assistant() -> None:
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

    uvicorn.run(create_app(), host="127.0.0.1", port=8855)
