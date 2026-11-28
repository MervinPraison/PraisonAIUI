# Chat Panel

> Composable embedded Agent Chat panel for split-pane workspaces beside tables, charts, or documents.

`chat_panel()` embeds a compact, full-streaming Agent Chat panel inside any `@aiui.page` layout — using the same WebSocket/SSE runtime, tool calls, reasoning traces, inline approvals, and `await aiui.send_block(...)` renderer as `/chat`.

Pair it with `aiui.columns([...])` to build split-pane agent workspaces (for example, live charts, data tables, spreadsheets, or a `doc_viewer` on the left and a dedicated assistant on the right).

## Python (@aiui.page)

```python
import praisonaiui as aiui

SALES = [
    {"Region": "US", "Revenue": 42000},
    {"Region": "EU", "Revenue": 31000},
    {"Region": "APAC", "Revenue": 24500},
]


@aiui.page("workspace", title="Sales Workspace", icon="layout-dashboard", group="App")
async def workspace():
    return aiui.layout([
        aiui.columns([
            aiui.container([
                aiui.metric("Total Revenue", value="$97,500", delta="+14%"),
                aiui.table(SALES, searchable=True),
                aiui.chart("Revenue by Region", data=SALES, chart_type="bar", x="Region", y="Revenue"),
            ]),
            aiui.chat_panel(
                title="Ask the Analyst",
                welcome="Ask me anything about Q4 regional revenue.",
                height=520,
            ),
        ]),
    ])


@aiui.reply
async def on_message(message: str):
    await aiui.say(f"Analyzing **{message}** across {len(SALES)} regions.")
    await aiui.send_block(aiui.table(SALES))
```

## YAML (app.yaml)

```yaml
- type: columns
  children:
    - type: doc_viewer
      title: "Architecture Spec"
      content: "# Overview\nReview the spec beside the assistant."
    - type: chat_panel
      title: "Spec Assistant"
      welcome: "Ask a question about this document."
      height: 540
```

## Behavior in embedded mode

- Runs in a compact frame with its own local session state (no duplicate sidebar rail and no `?session=` URL hijacking).
- Does not overwrite an explicit `welcome` message with the global `@aiui.welcome` greeting.
- Lazily loads the shared chat chunk only when a page actually includes `chat_panel`.

## Props

| Parameter | Type | Default | Description |
|---|---|---|---|
| `title` | `str` | `"Agent Chat"` | Header title displayed at the top of the panel. |
| `agent` | `str \| None` | `None` | Optional agent name to route panel messages to. |
| `height` | `int \| str` | `520` | Panel height in pixels (`>= 200`) or a CSS length (e.g. `"70vh"`). |
| `session_id` | `str \| None` | `None` | Optional initial session ID to resume inside the panel. |
| `welcome` | `str \| None` | `None` | Optional empty-state greeting shown inside the panel. |

## Related pages

- [Migrating from Streamlit](https://ui.praison.ai/docs/guides/from-streamlit.md)
- [Tabs](https://ui.praison.ai/docs/components/tabs.md)
- [List Detail](https://ui.praison.ai/docs/components/list-detail.md)
