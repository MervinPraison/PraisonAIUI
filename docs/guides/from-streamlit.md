---
title: Migrating from Streamlit
nav_title: From Streamlit
description: Side-by-side guide for moving Streamlit dashboards and chat apps to PraisonAIUI.
---

# Migrating from Streamlit

PraisonAIUI gives Python developers zero-JS UI components like Streamlit, **built natively for AI Agents** — with WebSocket streaming, tool calls, reasoning traces, inline approvals, persistent multi-session history, URL-synced filter bars, and built-in auth.

## API comparison

| Streamlit | PraisonAIUI (`aiui`) |
|---|---|
| `st.chat_message` / `st.chat_input` | `@aiui.reply` + `aiui.stream_token()` + `aiui.send_block(...)` |
| `st.dataframe(df)` | `aiui.table(df, searchable=True)` (pandas & Polars, works on pages and in chat) |
| `st.data_editor(df)` | `aiui.sheet("Data", headers=..., rows=..., action="save")` |
| `st.bar_chart(df)` / `st.plotly_chart(fig)` | `aiui.chart("Title", data=df, chart_type="bar")` / `aiui.plotly_chart(fig)` |
| `st.metric("Users", 42, "+12%")` | `aiui.metric("Users", value=42, delta="+12%", sparkline=[...])` |
| `st.file_uploader("CSV")` | `aiui.file_upload("CSV", name="doc", accept=".csv")` + `aiui.get_uploaded_file(data["doc"])` |
| `st.write_stream(gen)` | `yield aiui.layout([...])` inside `@aiui.register_page_action` or `aiui.interface()` |
| `st.columns(2)` | `aiui.columns([left, right])` (including `aiui.chat_panel()` for split-pane agent workspaces) |
| `streamlit run app.py` | `aiui run app.py` (opens cleanly in focused mode; pass `--preset ops` for full ops console) |

## Example: DataFrame + Split-Pane Agent

```python
# app.py
import praisonaiui as aiui

DATA = [{"Region": "US", "Revenue": 42000}, {"Region": "EU", "Revenue": 31000}]


@aiui.page("sales", title="Sales", icon="bar-chart-2", group="App")
async def sales():
    return aiui.layout([
        aiui.columns([
            aiui.container([
                aiui.table(DATA, searchable=True),
                aiui.chart("Revenue", data=DATA, chart_type="bar", x="Region", y="Revenue"),
            ]),
            aiui.chat_panel(title="Ask the Analyst", height=520),
        ])
    ])


@aiui.reply
async def on_message(message: str):
    await aiui.say(f"Analyzing `{message}` across {len(DATA)} regions.")
    await aiui.send_block(aiui.table(DATA))
```

## Key difference to know
Streamlit re-executes your whole script top-to-bottom on every widget click. PraisonAIUI uses explicit `@aiui.page` / `@aiui.register_page_action` handlers (or 5-line `aiui.interface()`) — so heavy models stay loaded in memory, filters live cleanly in the URL (`method="get"`), and chat sessions persist across reloads.
