# Step 3: Welcome Screen, Starters & Profiles

> Make your chat inviting with a custom greeting, clickable starter cards and selectable assistant personas.

In [Step 2](https://ui.praison.ai/docs/tutorials/connect-ai.md), your app began streaming real AI answers. Now let's make the first-time experience effortless so anyone opening the page immediately knows what to ask.

**What's new in Step 3:** `@aiui.welcome`, `@aiui.starters`, `@aiui.profiles`, and `@aiui.author_rename`.

## Add a welcoming first screen

1. **Add a greeting and one-click starter prompts**

   Add `@aiui.welcome` and `@aiui.starters` above `@aiui.reply` in `app.py`:

   ```python title="app.py"
   @aiui.welcome
   async def greet():
       await aiui.say("Hi! Pick a mode above or click a starter below to begin.")


   @aiui.starters
   def get_starters():
       return [
           {"label": "Summarize text", "message": "Summarize this paragraph into 3 clear bullet points."},
           {"label": "Draft an email", "message": "Help me write a polite follow-up email."},
           {"label": "Explain simply", "message": "Explain how cloud APIs work in plain English."},
       ]
   ```

2. **Offer switchable assistant profiles**

   Let users switch between specialized modes using `@aiui.profiles`, and read `message.agent_name` inside `@aiui.reply` (notice we remove the `: str` annotation so `message` is a `MessageContext`):

   ```python title="app.py"
   PROMPTS = {
       "General": "You are a helpful, concise assistant.",
       "Writer": "You are a crisp editor who writes clear, engaging prose.",
       "Analyst": "You organize answers into structured tables and key takeaways.",
   }


   @aiui.profiles
   def get_profiles():
       return [
           {"name": "General", "description": "Everyday questions and brainstorming"},
           {"name": "Writer", "description": "Emails, articles and clear editing"},
           {"name": "Analyst", "description": "Structured comparisons and tables"},
       ]


   @aiui.author_rename
   def rename_author(name: str) -> str:
       return {"Writer": "Writing Coach", "Analyst": "Data Analyst"}.get(name, name)


   @aiui.reply
   async def on_message(message):
       profile = message.agent_name or "General"
       system_prompt = PROMPTS.get(profile, PROMPTS["General"])

       history = aiui.user_session.get("messages", [])
       messages = [{"role": "system", "content": system_prompt}, *history, {"role": "user", "content": message.text}]

       stream = await client.chat.completions.create(model="gpt-4o-mini", messages=messages, stream=True)
       chunks = []
       async for chunk in stream:
           delta = chunk.choices[0].delta.content if chunk.choices else None
           if delta:
               chunks.append(delta)
               await aiui.stream_token(delta)

       history.extend([
           {"role": "user", "content": message.text},
           {"role": "assistant", "content": "".join(chunks)},
       ])
       aiui.user_session["messages"] = history
   ```

3. **Run and test the new empty screen**

   ```bash
   aiui run app.py
   ```

   Click any starter card to send it instantly, then start a new chat and switch to the **Writer** or **Analyst** profile.

## What you learned

- `@aiui.welcome` and `@aiui.starters` turn a blank screen into a guided experience.
- `@aiui.profiles` gives users switchable modes, while `message.agent_name` tells your handler which mode they picked.

## Next step

- [Step 4: Agent Reasoning, Steps & Tools](https://ui.praison.ai/docs/tutorials/steps-and-tools.md)
  Show live, collapsible tool calls and ask the user interactive questions mid-reply.
- [Step 2: Connect an AI Model](https://ui.praison.ai/docs/tutorials/connect-ai.md)
  Review Step 2.
