---
title: Migrating from Chainlit
nav_title: From Chainlit
description: Side-by-side guide for moving Chainlit agent chat apps to PraisonAIUI.
---

# Migrating from Chainlit

PraisonAIUI keeps the familiar decorator lifecycle (`@aiui.on_chat_start`, `@aiui.on_message`, `@aiui.on_stop`, `aiui.Message`, `aiui.Step`, `aiui.user_session`) while adding **81 interactive UI blocks** (usable both inline in chat and on custom pages), split-pane workspaces, selectable layouts, zero-code YAML apps, and an opt-in Agent Ops console.

## API comparison

| Chainlit (`cl`) | PraisonAIUI (`aiui`) |
|---|---|
| `@cl.on_chat_start` | `@aiui.on_chat_start` (or `@aiui.welcome`) |
| `@cl.on_message` | `@aiui.reply` (alias: `@aiui.on_message`) |
| `@cl.on_stop` | `@aiui.cancel` (alias: `@aiui.on_stop`) |
| `cl.Message(content=...).send()` | `await aiui.say(...)` or `await aiui.Message(...).send()` |
| `msg.stream_token(tok)` | `await aiui.stream_token(tok)` |
| `cl.Step(...)` | `async with aiui.Step(...)` / `await aiui.tool(...)` |
| `cl.Dataframe(df)` / `cl.Plotly(fig)` | `await aiui.send_block(aiui.table(df))` / `await aiui.send_block(aiui.plotly_chart(fig))` (plus `aiui.Dataframe` / `aiui.Plotly` also render natively) |
| Custom React Elements | 81 built-in Python/YAML blocks (`aiui.send_block(...)`) + `@aiui/sdk` plugins |
| `chainlit run app.py` | `aiui run app.py` (or `aiui run app.py --preset agent` for Sessions, Approvals, Usage, Memory) |

## Quick scaffold for your agent framework

```bash
pip install aiui
aiui init --template openai       # or: anthropic, langgraph, crewai, pydantic-ai, praisonai
aiui run app.py
```
