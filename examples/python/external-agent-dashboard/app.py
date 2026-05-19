"""Minimal external agent hosted on PraisonAIUI dashboard shell."""

import praisonaiui as aiui
from praisonaiui.server import create_app

aiui.set_style("dashboard")
aiui.set_branding(title="Acme Agents", logo="A")
aiui.set_pages(["chat", "tasks", "sessions", "config"])
aiui.set_dashboard(modules=["jobs"], sidebar=True, page_header=True)


@aiui.page("tasks", title="Tasks", icon="📋", group="Work", order=5)
async def tasks_page():
  return aiui.layout(
      [
          aiui.board(
              columns=[
                  {
                      "id": "todo",
                      "title": "Todo",
                      "cards": [
                          aiui.card("Review PR", footer="agent-a"),
                          aiui.card("Write docs", footer="agent-b"),
                      ],
                  },
                  {
                      "id": "done",
                      "title": "Done",
                      "cards": [aiui.card("Modular shell", footer="shipped")],
                  },
              ]
          ),
      ]
  )


app = create_app()
