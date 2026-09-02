# Meeting Agent (thin UI example)

A lightweight PraisonAIUI example that wires **existing** features together via
YAML/config to build a meeting assistant dashboard. It adds no agent-runtime
logic and no agent-callable tools.

## What this example includes

| Page | Built from |
|------|-----------|
| Upload | `attachments` feature (`POST /api/chat/attachments`) + status copy |
| Meetings | dashboard page (`aiui.table` / `aiui.metric`) |
| Meeting detail | tabbed dashboard page — Transcript / Summary / Action items |
| Chat | `@aiui.reply` with a system prompt enforcing *search meetings first* + citation chips |

Slack delivery (`/meeting-summary <id>`) uses the existing
`SlackChannelAdapter` and is **optional** — the dashboard runs without any Slack
tokens (dashboard-only mode). `slack_sdk` is imported lazily, only when tokens
are present.

## Run

```bash
cp .env.example .env   # optional; dashboard works without any tokens
aiui run app.py
# or
python app.py          # honours MEETING_AGENT_PORT
```

## Where the rest lives (routed out)

This repo intentionally hosts only the thin UI slice. The agent and tools live
in separate repositories:

- **Agent core** (`build_agent`, instructions, summarization pipeline, storage,
  status state machine) → `MervinPraison/PraisonAI` (**PAI-MEET-CORE**).
- **Tools** (`search_meetings`, transcription, indexing, etc.) →
  `MervinPraison/PraisonAI-Tools` (**PAI-MEET-TOOLS**).

Point this UI at your running agent via the standard PraisonAI provider/jobs
configuration; no changes to `praisonaiui` internals are required.

## Environment

See `.env.example`:

- `OPENAI_API_KEY` — used by the agent (PAI-MEET-CORE).
- `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` — optional Slack delivery.
- `MEETING_AGENT_PORT` — local dev port.
