# Step 4: Show Agent Reasoning, Steps & Interactive Prompts

> Make your agent transparent by displaying timed tool steps, asking clarifying questions mid-reply and adding action buttons.

Real AI agents rarely just call one prompt — they search documents, query APIs, or ask the user before taking action. In this step, you will make every behind-the-scenes action visible as a clean, collapsible timeline.

**What's new in Step 4:** `@aiui.step`, `aiui.Step`, `aiui.prompt()`, and `aiui.action_buttons()` with `@aiui.button()`.

## Make agent work visible and interactive

1. **Wrap a tool function with @aiui.step**

   Decorate any Python function with `@aiui.step(type="tool")`. PraisonAIUI automatically records its inputs, return value, status, and duration — and shows it as a collapsible card in the chat:

   ```python title="app.py"
   @aiui.step("Search knowledge base", type="tool")
   def search_docs(query: str) -> list[str]:
       # Replace with your real search, database, or API call
       return [f"Guide matching '{query}'", f"Checklist for '{query}'"]
   ```

2. **Group nested work with aiui.Step and ask a clarifying question**

   Inside `@aiui.reply`, open an `async with aiui.Step(...)` block for high-level phases, and pause with `aiui.prompt()` whenever you want human input before finishing:

   ```python title="app.py"
   @aiui.reply
   async def on_message(message):
       async with aiui.Step("Research", type="run") as research:
           await research.stream_token("Looking up matching references...\n")
           hits = search_docs(message.text)  # Nested automatically under "Research"

       style = await aiui.prompt(
           "How detailed should the answer be?",
           options=["Quick summary", "Detailed breakdown"],
       )
       depth = style.choice if style else "Quick summary"

       await aiui.say(
           f"### {depth}\n\n"
           f"Based on **{len(hits)}** references ({', '.join(hits)}), here is your answer for: *{message.text}*"
       )
       await aiui.action_buttons([
           {"name": "save_note", "label": "Save as note"},
           {"name": "regenerate", "label": "Try another angle"},
       ])
   ```

3. **Handle button clicks**

   Register handlers for the action buttons you displayed:

   ```python title="app.py"
   @aiui.button("save_note")
   async def on_save_note():
       await aiui.notify("Saved to your workspace notes", type="success")
   ```

> **Tip:**
> Steps are saved with the conversation, so reloading the browser keeps the exact collapsible step tree and timings. See [Steps](https://ui.praison.ai/docs/features/steps.md) for all step types (`run`, `tool`, `llm`, `retrieval`, `sub_agent`).

## What you learned

- `@aiui.step` and `async with aiui.Step(...)` show users *why* an agent gave an answer and how long each tool took.
- `aiui.prompt()` pauses for human choices, and `aiui.action_buttons()` adds one-click follow-ups.

## Next step

- [Step 5: Rich UI, Notifications & Custom Pages](https://ui.praison.ai/docs/tutorials/rich-ui-and-pages.md)
  Add custom dashboard pages, try the side-by-side canvas layout and push live bell notifications.
- [Step 3: Welcome, Starters & Profiles](https://ui.praison.ai/docs/tutorials/welcome-and-starters.md)
  Review Step 3.
