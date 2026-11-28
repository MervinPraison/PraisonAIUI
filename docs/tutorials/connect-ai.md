# Step 2: Connect an AI Model & Stream Replies

> Upgrade your chat app with live token-by-token AI streaming and per-conversation memory.

In [Step 1](https://ui.praison.ai/docs/tutorials/first-chat.md), your app echoed messages back. Now let's connect a real AI model, stream each word live as it is generated, and remember earlier messages in the conversation.

**What's new in Step 2:** `aiui.stream_token()`, `@aiui.on_chat_start`, and per-chat memory with `aiui.user_session`.

## Upgrade your app

1. **Install a model client and set your API key**

   Install the OpenAI Python SDK (or any provider library you prefer — PraisonAIUI works with every model SDK):

   ```bash
   pip install openai
   ```

   Create a `.env` file in your project folder (do not commit this file to Git):

   ```bash title=".env"
   OPENAI_API_KEY=sk-your-key-here
   ```

   `aiui run` automatically loads `.env` from your current folder.

2. **Stream tokens and keep chat memory**

   Update `app.py` so every chat initializes its own message history and streams replies word by word:

   ```python title="app.py"
   import praisonaiui as aiui
   from openai import AsyncOpenAI

   client = AsyncOpenAI()


   @aiui.on_chat_start
   async def start_chat():
       aiui.user_session["messages"] = [
           {"role": "system", "content": "You are a clear, friendly assistant."}
       ]


   @aiui.reply
   async def on_message(message: str):
       history = aiui.user_session.get("messages", [])
       history.append({"role": "user", "content": message})

       stream = await client.chat.completions.create(
           model="gpt-4o-mini",
           messages=history,
           stream=True,
       )

       chunks = []
       async for chunk in stream:
           delta = chunk.choices[0].delta.content if chunk.choices else None
           if delta:
               chunks.append(delta)
               await aiui.stream_token(delta)

       history.append({"role": "assistant", "content": "".join(chunks)})
       aiui.user_session["messages"] = history
   ```

3. **Run and try a follow-up question**

   ```bash
   aiui run app.py
   ```

   Ask *"Give me 3 ideas for a weekend project"*, then follow up with *"Expand on idea #2"*. Because `aiui.user_session` is isolated per chat, the assistant remembers the context and clicking **Stop** cleanly cancels a slow generation.

> **Tip:**
> Prefer zero code? With `pip install "aiui[praisonai]"`, a 3-line YAML file (`name`, `instructions`, `model: gpt-4o-mini`) run via `aiui run chat.yaml` streams replies and manages memory automatically.

## What you learned

- `await aiui.stream_token(text)` displays replies live as tokens arrive instead of making users wait.
- `@aiui.on_chat_start` and `aiui.user_session` give every conversation its own private state.

## Next step

- [Step 3: Welcome, Starters & Profiles](https://ui.praison.ai/docs/tutorials/welcome-and-starters.md)
  Greet visitors, add one-click starter prompts and let users pick an assistant persona.
- [Step 1: Your First Chat App](https://ui.praison.ai/docs/tutorials/first-chat.md)
  Review Step 1.
