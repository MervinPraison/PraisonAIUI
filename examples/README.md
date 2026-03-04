# Examples

Three core examples, from simplest to full-featured:

## 1. [chat/](chat/) — Basic Chat

Minimal echo chat. **8 lines.** Start here to understand the callback pattern.

```bash
aiui run app.py
```

## 2. [chat-with-ai/](chat-with-ai/) — Chat with AI

LLM-powered chat using OpenAI with streaming, conversation context, and starter messages.

```bash
export OPENAI_API_KEY=sk-...
aiui run app.py
aiui run app.py --datastore json   # persist history
```

## 3. [agent-playground/](agent-playground/) — Agent Playground

Multi-agent playground UI:
- 4 agents (General, Coder, Analyst, Writer) with profile selection
- Per-agent conversation context
- Session management + persistence
- Streaming responses

```bash
export OPENAI_API_KEY=sk-...
aiui run app.py --datastore json
```
