# Agent UI Overview

> Build streaming AI agent interfaces in minutes with Python decorators or zero-code YAML.

PraisonAIUI gives any AI model or agent a polished, responsive agent interface without writing frontend code. Every app ships with streaming Markdown, tool calls, reasoning steps, approvals, code blocks, conversation history, light and dark themes, and mobile support out of the box.

## Two ways to build an agent app

Pick whichever matches how you work — you can switch or combine them at any time.

### Python (5 lines)

Use simple decorators in `app.py` to hook into any model, SDK, or custom logic:

```python title="app.py"
import praisonaiui as aiui


@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You said: {message}")
```

Run it with `aiui run app.py`.

### Zero-code YAML

Define an AI assistant without writing Python (`pip install "aiui[praisonai]"` and set `OPENAI_API_KEY`):

```yaml title="chat.yaml"
name: Support Assistant
instructions: You are a friendly product specialist. Keep answers short and clear.
model: gpt-4o-mini
welcome: "Hi! Ask me anything about getting started."
starters:
  - label: "Explain features"
    message: "What are the top 3 features?"
  - label: "Help me set up"
    message: "Walk me through the first setup step."
```

Run it with `aiui run chat.yaml`.

## What Agent UI includes out of the box

| Capability | What your users see | Learn more |
|------------|---------------------|------------|
| **Lifecycle hooks** | Greeting on open, per-chat setup, live Stop button, clean-up on exit | [Chat lifecycle](https://ui.praison.ai/docs/chat-ui/lifecycle.md) |
| **Streaming & prompts** | Token-by-token replies, interactive questions, action buttons and toasts | [Messages & streaming](https://ui.praison.ai/docs/chat-ui/messages-and-streaming.md) |
| **Starters & profiles** | One-click starter cards on empty chats and selectable assistant personas | [Starters & profiles](https://ui.praison.ai/docs/chat-ui/starters-and-profiles.md) |
| **Reasoning & tool steps** | Collapsible, timed tree of tool calls, searches and sub-runs | [Steps](https://ui.praison.ai/docs/features/steps.md) |
| **Artifacts canvas** | Side-by-side preview for generated code, tables, diagrams and files | [A2UI canvas](https://ui.praison.ai/docs/features/a2ui-canvas.md) |
| **Attachments & media** | Drag-and-drop uploads, inline images, audio, video and downloadable files | [Attachments](https://ui.praison.ai/docs/features/attachments.md) |
| **Voice & MCP tools** | Spoken replies, real-time voice input and external MCP tool servers | [MCP servers](https://ui.praison.ai/docs/features/mcp.md) |

## Learn the core concepts in order

- [1. Chat lifecycle](https://ui.praison.ai/docs/chat-ui/lifecycle.md)
  Understand when welcome, start, reply, stop and end handlers run.
- [2. Messages & streaming](https://ui.praison.ai/docs/chat-ui/messages-and-streaming.md)
  Send replies, stream tokens, ask follow-up questions and show action buttons.
- [3. Starters & profiles](https://ui.praison.ai/docs/chat-ui/starters-and-profiles.md)
  Guide new users with clickable prompt cards and switchable assistant modes.
- [4. Steps & reasoning](https://ui.praison.ai/docs/features/steps.md)
  Show live, collapsible tool calls and thinking steps inside every reply.

## Related pages

- [A2UI — Agent-to-User Interface](https://ui.praison.ai/docs/a2ui/overview.md)
- [Chat & Agent Examples](https://ui.praison.ai/docs/examples/basic.md)
- [Migrating from Decorator Chat Apps](https://ui.praison.ai/docs/guides/from-chat-apps.md)
