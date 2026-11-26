---
title: Chat UI Overview
nav_title: Overview
description: Build streaming AI chat interfaces in minutes with Python decorators or zero-code YAML.
---

# Chat UI Overview

PraisonAIUI gives any AI model or agent a polished, responsive chat interface without writing frontend code. Every chat app ships with streaming Markdown, code blocks, conversation history, light and dark themes, and mobile support out of the box.

## Two ways to build a chat app

Pick whichever matches how you work — you can switch or combine them at any time.

<Tabs>
<Tab title="Python (5 lines)">
Use simple decorators in `app.py` to hook into any model, SDK, or custom logic:

```python title="app.py"
import praisonaiui as aiui


@aiui.reply
async def on_message(message: str):
    await aiui.say(f"You said: {message}")
```

Run it with `aiui run app.py`.
</Tab>
<Tab title="Zero-code YAML">
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
</Tab>
</Tabs>

## What Chat UI includes out of the box

| Capability | What your users see | Learn more |
|------------|---------------------|------------|
| **Lifecycle hooks** | Greeting on open, per-chat setup, live Stop button, clean-up on exit | [Chat lifecycle](lifecycle.md) |
| **Streaming & prompts** | Token-by-token replies, interactive questions, action buttons and toasts | [Messages & streaming](messages-and-streaming.md) |
| **Starters & profiles** | One-click starter cards on empty chats and selectable assistant personas | [Starters & profiles](starters-and-profiles.md) |
| **Reasoning & tool steps** | Collapsible, timed tree of tool calls, searches and sub-runs | [Steps](../features/steps.md) |
| **Artifacts canvas** | Side-by-side preview for generated code, tables, diagrams and files | [A2UI canvas](../features/a2ui-canvas.md) |
| **Attachments & media** | Drag-and-drop uploads, inline images, audio, video and downloadable files | [Attachments](../features/attachments.md) |
| **Voice & MCP tools** | Spoken replies, real-time voice input and external MCP tool servers | [MCP servers](../features/mcp.md) |

## Learn the core concepts in order

<CardGroup cols={2}>
<Card title="1. Chat lifecycle" icon="refresh-cw" href="lifecycle.md">
Understand when welcome, start, reply, stop and end handlers run.
</Card>
<Card title="2. Messages & streaming" icon="message-square" href="messages-and-streaming.md">
Send replies, stream tokens, ask follow-up questions and show action buttons.
</Card>
<Card title="3. Starters & profiles" icon="sparkles" href="starters-and-profiles.md">
Guide new users with clickable prompt cards and switchable assistant modes.
</Card>
<Card title="4. Steps & reasoning" icon="git-branch" href="../features/steps.md">
Show live, collapsible tool calls and thinking steps inside every reply.
</Card>
</CardGroup>
