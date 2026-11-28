# Migrating from Gradio

> Side-by-side guide for moving Gradio demos and Chatbot apps to PraisonAIUI.

Move from a prototype Gradio demo to a production multi-page Agent UI with persistent sessions, auth, inline approvals, and 81 composable blocks — while keeping Gradio's 5-line function simplicity via `aiui.interface()`.

## API comparison

| Gradio | PraisonAIUI (`aiui`) |
|---|---|
| `gr.Interface(fn, inputs, outputs).launch()` | `aiui.interface(fn, inputs=[...], title="App")` + `aiui run app.py` |
| `gr.ChatInterface(fn)` | `@aiui.reply` + `await aiui.stream_token(tok)` |
| `gr.File()` | `aiui.file_upload("Upload", name="doc")` + `aiui.get_uploaded_file(doc)` |
| Generator `yield` streaming | `yield` directly inside `aiui.interface()` or `@aiui.register_page_action` |
| `gr.Chatbot` inside `gr.Blocks` | `aiui.chat_panel()` inside `aiui.columns([...])` |
| `gr.Dataframe` / `gr.Plot` | `aiui.table(df)` / `aiui.chart(data=df)` / `aiui.plotly_chart(fig)` |

## 5-line streaming equivalent

### PraisonAIUI

```python title="app.py"
import praisonaiui as aiui


async def summarize(text: str, tone: str = "Brief"):
    acc = ""
    for word in f"**{tone} summary:** {text[:140]}".split():
        acc = f"{acc} {word}".strip()
        yield acc


aiui.interface(
    summarize,
    inputs=[
        aiui.textarea_input("Source text", name="text"),
        aiui.select_input("Tone", name="tone", options=["Brief", "Detailed"], value="Brief"),
    ],
    title="Summarizer",
)
```

### Gradio

```python
import gradio as gr

def summarize(text, tone):
    yield f"**{tone} summary:** {text[:140]}"

gr.Interface(
    summarize,
    inputs=[gr.Textbox(lines=4), gr.Dropdown(["Brief", "Detailed"], value="Brief")],
    outputs="markdown",
).launch()
```

## Honest note on multimodal capture
For live webcam/sketchpad ML model demos (`gr.Image(tool="sketch")`, `gr.Webcam`), Gradio remains specialized for ML demos. PraisonAIUI shines when you are shipping **AI Agent applications** with tool calls, approvals, dashboards, file uploads, and authentication.

## Related pages

- [Migrating from Decorator Chat Apps](https://ui.praison.ai/docs/guides/from-chat-apps.md)
- [Migrating from Streamlit](https://ui.praison.ai/docs/guides/from-streamlit.md)
- [ADP Implementation Status](https://ui.praison.ai/docs/protocols/adp/implementation-status.md)
