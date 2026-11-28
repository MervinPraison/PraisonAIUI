# Starters, Profiles & Author Names

> Help users start fast with clickable prompt suggestions, switchable assistant personas and friendly display names.

A blank chat box can feel intimidating. Starters show users what your assistant can do on the very first click, while profiles let them pick a specialized mode (such as **General**, **Code**, or **Writer**).

## Clickable conversation starters

Return a list of `{label, message}` items from `@aiui.starters`. They appear as cards on every empty conversation.

### Python

```python title="app.py"
import praisonaiui as aiui


@aiui.starters
def get_starters():
    return [
        {"label": "Summarize notes", "message": "Summarize my meeting notes into 3 bullet points."},
        {"label": "Draft an email", "message": "Help me write a short project update email."},
        {"label": "Explain a concept", "message": "Explain APIs in plain English."},
    ]


@aiui.reply
async def on_message(message: str):
    await aiui.say(f"Working on: {message}")
```

### YAML

```yaml title="chat.yaml"
name: Team Assistant
model: gpt-4o-mini
welcome: "How can I help today?"
starters:
  - label: "Summarize notes"
    message: "Summarize my meeting notes into 3 bullet points."
  - label: "Draft an email"
    message: "Help me write a short project update email."
```

## Switchable chat profiles

Use `@aiui.profiles` to offer multiple personas or models in the UI. Inside `@aiui.reply`, inspect `message.agent_name` to route to the chosen profile.

```python title="app.py"
import praisonaiui as aiui


@aiui.profiles
def get_profiles():
    return [
        {"name": "General", "description": "Everyday answers and brainstorming"},
        {"name": "Writer", "description": "Polished emails, posts and docs"},
        {"name": "Analyst", "description": "Structured tables and comparisons"},
    ]


@aiui.reply
async def on_message(message):
    mode = message.agent_name or "General"
    await aiui.say(f"[{mode}] Received: {message.text}")
```

## Customize author display names

When internal agent IDs look technical (like `support_triage_v2`), map them to friendly display names with `@aiui.author_rename`:

```python
@aiui.author_rename
def rename(name: str) -> str:
    return {
        "support_triage_v2": "Support Specialist",
        "billing_agent": "Billing Assistant",
    }.get(name, name)
```

## Collect user feedback

Turn on thumbs-up / thumbs-down buttons and log ratings with `@aiui.on("feedback")`:

```python
aiui.set_chat_features(feedback=True)


@aiui.on("feedback")
async def on_feedback(event):
    print(event["session_id"], event["message_id"], event["value"], event.get("comment"))
```

## Next steps

- [Steps & reasoning](https://ui.praison.ai/docs/features/steps.md)
  Show live progress when your assistant calls tools or searches data.
- [App & Dashboard overview](https://ui.praison.ai/docs/app-ui/overview.md)
  Add custom dashboard pages, layouts and notifications around your chat.

## Related pages

- [Guided Studio layout](https://ui.praison.ai/docs/features/layouts/guided.md)
- [Messages, Streaming & Interactions](https://ui.praison.ai/docs/chat-ui/messages-and-streaming.md)
- [Chat & Agent Examples](https://ui.praison.ai/docs/examples/basic.md)
