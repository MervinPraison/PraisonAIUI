"""Example 32 — an agent that writes the canvas with tools.

The agent gets the canvas tools (``aiui.canvas.tools()``): canvas_write,
canvas_update, canvas_read and canvas_list. Ask it

    Make a comparison table of 3 sorting algorithms in the canvas

and then

    add a Stable column

The canvas shows the table as v1, then v2, both by the agent: the second
version comes from canvas_read + canvas_update on the same name, not from
the model repeating the table in its reply.

Requires: pip install aiui praisonaiagents; OPENAI_API_KEY set.

Run:
    aiui run app.py
"""

import os

from praisonaiagents import Agent

import praisonaiui as aiui

aiui.set_style("app")
aiui.set_layout("chat-canvas")
aiui.set_branding(title="Canvas Agent", logo="🗂️")

agent = Agent(
    name="Analyst",
    instructions=(
        "You are a concise analyst. Put every table, document or code file the user "
        "asks for in the canvas with canvas_write (a markdown table for tables), and "
        "reply with one short sentence instead of repeating it. To change an artifact, "
        "call canvas_read, then canvas_update with the full new content. "
        "Start a comparison table with the essentials only (name, average and worst "
        "time); add columns when the user asks for them."
    ),
    llm=os.environ.get("MODEL_NAME", "gpt-4o-mini"),
    tools=aiui.canvas.tools(),
)
aiui.register_agent("Analyst", agent)


@aiui.starters
async def starters():
    return [
        {"label": "Sorting table", "message": "Make a comparison table of 3 sorting algorithms in the canvas"},
        {"label": "Add a column", "message": "add a Stable column"},
    ]
