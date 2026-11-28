# Messages, Streaming & Interactions

> Send complete replies, stream tokens live, ask the user follow-up questions, attach media and trigger clickable buttons.

Inside `@aiui.reply` (or `@aiui.on_chat_start`), PraisonAIUI gives you simple async functions to communicate with the user.

## Send or stream text

Use `aiui.say()` when you already have the full reply, or `aiui.stream_token()` to display tokens live as your AI model generates them.

```python title="app.py"
import asyncio
import praisonaiui as aiui


@aiui.reply
async def on_message(message: str):
    # Stream word by word (works with any LLM streaming iterator)
    for word in f"Here is a live streamed reply to: {message}".split():
        await aiui.stream_token(word + " ")
        await asyncio.sleep(0.05)
```

Markdown — headings, tables, links, math, and syntax-highlighted code blocks — renders automatically as tokens arrive.

## Ask a question mid-reply

Pause the agent to ask the user for clarification or confirmation using `aiui.prompt()`. It waits for the user's answer and returns a result object (`answer.text` or `answer.choice`).

```python title="app.py"
import praisonaiui as aiui


@aiui.reply
async def on_message(message: str):
    tone = await aiui.prompt(
        "Which tone would you like?",
        options=["Friendly", "Formal", "Concise"],
    )
    if tone:
        await aiui.say(f"Drafting a **{tone.choice}** response to: {message}")
```

## Add clickable action buttons

Show buttons below a message with `aiui.action_buttons()` and handle clicks with `@aiui.button("<name>")`:

```python title="app.py"
import praisonaiui as aiui


@aiui.reply
async def on_message(message: str):
    await aiui.say(f"Draft ready for: {message}")
    await aiui.action_buttons([
        {"name": "shorter", "label": "Make it shorter"},
        {"name": "polish", "label": "Polish tone"},
    ])


@aiui.button("shorter")
async def handle_shorter():
    await aiui.say("Here is a tighter one-sentence version.")
```

## Send interactive UI blocks inline

Render any of PraisonAIUI's **81 UI blocks** — metrics, searchable tables, pandas/Polars DataFrames, Plotly figures, charts, spreadsheets, whiteboards, cards, or `aiui.layout([...])` — directly inside a chat reply with `await aiui.send_block(...)`:

```python title="app.py"
import praisonaiui as aiui


@aiui.reply
async def on_message(message: str):
    await aiui.say(f"Live breakdown for **{message}**:")
    await aiui.send_block(
        aiui.columns([
            aiui.metric("Latency", value="42 ms", delta="-8%"),
            aiui.metric("Success Rate", value="99.4%", delta="+0.3%"),
        ])
    )
    await aiui.send_block(aiui.table([{"Region": "US", "Runs": 412}, {"Region": "EU", "Runs": 289}], searchable=True))
```

## Send media and notifications

| Helper | Purpose | Example |
|--------|---------|---------|
| `await aiui.send_block(block)` | Render any UI block, DataFrame, or Plotly figure inline | `await aiui.send_block(aiui.table(df, searchable=True))` |
| `await aiui.image(url, alt="")` | Display an inline image | `await aiui.image("/static/chart.png", "Sales chart")` |
| `await aiui.audio(url)` | Embed an audio player | `await aiui.audio("/static/briefing.mp3")` |
| `await aiui.video(url)` | Embed a video player | `await aiui.video("/static/demo.mp4")` |
| `await aiui.file(url, name="")` | Attach a downloadable file | `await aiui.file("/static/report.pdf", "report.pdf")` |
| `await aiui.notify(msg, type="info")` | Show a toast (pass `persist=True` to also save in the header bell) | `await aiui.notify("Saved!", type="success", persist=True)` |
| `await aiui.error(msg, details=...)` | Show a formatted error card | `await aiui.error("Request failed", details=str(exc))` |

> **Tip:**
> Want rich cards, tables, or side-by-side previews inside chat? See [Message elements](https://ui.praison.ai/docs/features/message-elements.md) and [A2UI canvas](https://ui.praison.ai/docs/features/a2ui-canvas.md).

## Next steps

- [Starters & profiles](https://ui.praison.ai/docs/chat-ui/starters-and-profiles.md)
  Give new visitors one-click prompts and switchable assistant modes.
- [Steps & reasoning](https://ui.praison.ai/docs/features/steps.md)
  Wrap tool calls and searches in collapsible, timed steps.

## Related pages

- [Chat Lifecycle](https://ui.praison.ai/docs/chat-ui/lifecycle.md)
- [Starters, Profiles & Author Names](https://ui.praison.ai/docs/chat-ui/starters-and-profiles.md)
- [Steps](https://ui.praison.ai/docs/features/steps.md)
