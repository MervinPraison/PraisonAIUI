# Step 1: Your First Chat App

> Install PraisonAIUI and launch your first working chat app in two minutes — using either 5 lines of Python or zero-code YAML.

In this step-by-step series, you will build a complete AI web app one feature at a time. Each step adds **one clear upgrade** to the same app, so you can follow along even if you have never built a web interface before.

**What you will build in Step 1:** A live chat app running in your browser at `http://127.0.0.1:8000` with light/dark mode, Markdown rendering and a conversation sidebar.

## Build it step by step

1. **Install PraisonAIUI**

   Make sure you have Python 3.10 or newer, then install the `aiui` package:

   ```bash
   pip install aiui
   ```

2. **Create your first app**

   Choose **Python** (full flexibility, no API key needed yet) or **Zero-code YAML** (an AI assistant with zero Python code):

   ### Python (app.py)

   Create a folder for your project and save this file as `app.py`:

   ```python title="app.py"
   import praisonaiui as aiui


   @aiui.reply
   async def on_message(message: str):
       await aiui.say(f"You said: **{message}**")
   ```

   `@aiui.reply` tells PraisonAIUI which function to run whenever a user sends a message. `await aiui.say(...)` sends the reply back to the chat.

   ### Zero-code YAML (chat.yaml)

   If you prefer YAML over Python, install the agent extra (`pip install "aiui[praisonai]"`), set `OPENAI_API_KEY`, and save `chat.yaml`:

   ```yaml title="chat.yaml"
   name: My First Assistant
   instructions: You are a helpful, concise assistant.
   model: gpt-4o-mini
   welcome: "Hi! Ask me anything to get started."
   ```

3. **Start the server and test it**

   Run your file from the terminal:

   ```bash
   aiui run app.py
   # Or, if you created chat.yaml:
   # aiui run chat.yaml
   ```

   Open **http://127.0.0.1:8000**, type a message, and press Enter.

> **Tip:**
> If port 8000 is already in use, `aiui run` automatically picks the next open port and prints the exact URL in your terminal.

## What you learned

- One command (`aiui run`) launches a complete React web app without touching HTML, CSS, or JavaScript.
- `@aiui.reply` receives user text and `aiui.say()` sends a Markdown-formatted reply.

## Next step

- [Step 2: Connect an AI Model & Stream](https://ui.praison.ai/docs/tutorials/connect-ai.md)
  Replace the echo reply with a real AI model that streams tokens live and remembers conversation history.
- [Agent UI Overview](https://ui.praison.ai/docs/chat-ui/overview.md)
  See the full map of Agent UI capabilities.
