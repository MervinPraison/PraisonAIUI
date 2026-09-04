# Meeting Agent (Phase 1 upload + Phase 2 Recall.ai live bots)

A PraisonAIUI example that wires the dashboard to **PraisonAI-Tools** meeting
tools for upload → transcribe → summarize → index → search, plus **Recall.ai**
Meeting Bots for live Zoom / Meet / Teams capture.

## What this example includes

| Page | Built from |
|------|-----------|
| Upload | `POST /api/meetings/upload` (audio → Phase 1 pipeline) |
| Live bot | `POST /api/recall/bots` — send a Recall bot to a meeting URL |
| Meetings | dashboard table backed by `list_meetings` |
| Meeting detail | transcript / summary / action items + live status |
| Calendar | Calendar V2 setup instructions + status API |
| Chat | meeting agent with `search_meetings` + optional `schedule_recall_bot` tool |

## Recall.ai workspace

This integration targets the **Praison** workspace in **EU (Frankfurt)**:

- Workspace ID: `33a035c7-03c1-4ec9-b752-18cdfbbefc42`
- API region: `eu-central-1`

Follow the [Recall onboarding guide](https://docs.recall.ai/docs/agent-quickstarts) via Recall MCP (`recall://guides/onboarding`) for credential and webhook setup.

## Run

```bash
cp .env.example .env   # set OPENAI_API_KEY + Recall vars (server-side only)
pip install praisonai-tools[meeting] httpx
aiui run app.py
# or
python app.py          # honours MEETING_AGENT_PORT
python app.py --smoke  # non-binding Recall boundary smoke
```

## Schedule a live bot

```bash
curl -X POST http://127.0.0.1:8000/api/recall/bots \
  -H "Content-Type: application/json" \
  -d '{"meeting_url":"https://zoom.us/j/123456789","title":"Standup"}'
```

Flow: **Create Bot** → webhooks (`bot.*`, `recording.done`, `transcript.done`) →
async Recall transcription → Phase 1 summarize + index → dashboard `ready`.

## Webhooks (required)

Set `PUBLIC_API_BASE_URL` to a stable **HTTPS** backend URL (reserved ngrok
domain in dev — not localhost). Register in Recall:

- URL: `{PUBLIC_API_BASE_URL}/webhooks/recall`
- Events: `bot.joining_call`, `bot.in_call_recording`, `bot.done`, `bot.fatal`,
  `recording.done`, `transcript.done`, `transcript.failed`

Use Recall MCP `create_webhook_endpoint` or the dashboard. Verify with
`send_test_webhook_endpoint`.

## Google Calendar V2

Default **CALENDAR_AUTO_RECORD=true** schedules bots for eligible future events
with video links once Calendar V2 is connected.

1. Set `PUBLIC_API_BASE_URL` (HTTPS tunnel).
2. Run Recall MCP `start_calendar_integration_setup` with
   `production_redirect_uri={PUBLIC_API_BASE_URL}/api/recall/calendar/callback`.
3. Bootstrap the app: `POST /api/recall/calendar/setup/bootstrap` with
   `setup_id` and `regional_callback_uri` from MCP.
4. Complete Google OAuth per `recall://guides/calendar-v2-setup-google`.

**Recording opt-in:** calendar sync ≠ automatic recording for every meeting;
this app uses `CALENDAR_AUTO_RECORD` (default on). Set `false` to disable
auto-schedule while keeping calendar connected.

## Environment

See `.env.example`:

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Summaries, embeddings, chat |
| `RECALL_REGION` | `eu-central-1` |
| `RECALL_API_KEY` | Recall REST API (backend only) |
| `RECALL_WEBHOOK_VERIFICATION_SECRET` | Webhook signature verification |
| `PUBLIC_API_BASE_URL` | Public HTTPS origin for webhooks + calendar callback |
| `CALENDAR_AUTO_RECORD` | Auto-schedule bots from calendar (default `true`) |

Never commit real secrets. Reuse the existing REST key (`Mervin Praison`) when
its purpose is clear; otherwise create a purpose-named key via Recall MCP.

## Tests

From repo root:

```bash
pytest tests/unit/test_meeting_agent_example.py tests/unit/test_meeting_agent_pipeline.py tests/unit/test_meeting_agent_recall.py -v
```
