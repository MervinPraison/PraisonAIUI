# Voice Agent example — PraisonAIUI

Phone and web voice agents using an external telephony/voice platform for STT/TTS/calls and PraisonAI for tools + dashboard.

## Quick start

```powershell
cd examples/python/voice-agent
copy .env.example .env
# Fill VOICE_API_BASE, VOICE_PRIVATE_API_KEY, VOICE_ASSISTANT_ID, etc.

# Fully automatic (app + tunnel + provider config):
.\setup_all.ps1

# Or step by step:
.\start_dev.ps1
```

Dashboard: http://127.0.0.1:8001

## Provider setup

1. Create an **assistant** with tools `get_current_time` and `echo_message`
2. Set **webhook URL** to `{PUBLIC_API_BASE_URL}/webhooks/voice`
3. Set **webhook secret header** `X-Voice-Webhook-Secret` → same as `VOICE_SERVER_URL_SECRET` in `.env`
4. Add a phone number and copy `VOICE_PHONE_NUMBER_ID`

Or run `py -3.13 setup_voice_provider.py` after `start_dev.ps1`.

## API

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/voice/calls` | POST | Outbound call `{ "customer_number": "+1..." }` |
| `/api/voice/calls` | GET | List stored calls |
| `/api/voice/calls/{id}` | GET | Call detail + transcript |
| `/api/voice/calls/{id}/live-transcript` | GET | SSE live transcript stream |
| `/api/voice/web-config` | GET | Browser talk widget config |
| `/webhooks/voice` | POST | Provider webhooks (tool-calls, transcript, end-of-call) |
| `/api/voice/config` | GET | Config status |
| `/api/voice/doctor` | GET | Voice stack health checks (.env, ports, APIs, tunnel) |

## Phase 2 features

- **Live transcript** — `GET /api/voice/calls/{id}/live-transcript` (SSE); **Call detail** page uses `plugin.js` + EventSource
- **Dynamic assistant** — set `VOICE_DYNAMIC_ASSISTANT=true` so `assistant-request` returns inline config with agent tool names
- **Agent tools** — `tool-calls` run through `integrations/voice/agent_runner.py` (same registry as dashboard chat)
- **Web talk** — **Web talk** page loads provider web SDK from `VOICE_WEB_SDK_URL` / `VOICE_WEB_SDK_GLOBAL`
- **Chat bridge** — final transcript lines and end-of-call summaries appear in **Chat** sidebar as `📞 Call …` sessions

Optional: `VOICE_AGENT_EXTRA_TOOLS=meeting_search` adds meeting search when `praisonai_tools` is installed.

## Cross-call memory (PraisonAI sessions)

Stable browser `voice-user-id` (localStorage) maps to `voice-user-{id}` PraisonAI session folder. Prior turns reload on new calls/restarts when `VOICE_MEMORY_ENABLED=true` (default).

| Route | Purpose |
|-------|---------|
| `/api/voice/memory/attach-user` | ElevenLabs — attach user before conversation starts |
| `/api/voice/memory/bind` | Bind `call_id` + `user_id` |
| `/api/voice/memory/resolve?user_id=` | Resolve Praison session id |

Knowledge base entries are injected into voice prompts when available.

## Call detail UI (PraisonAIUI components)

Call detail uses server-built components (`code_block`, `badge`, `key_value_list`, `tabs`) via `GET /api/voice/calls/{id}/ui`. Live SSE updates the transcript code block. Mic/WebRTC talk pages still use minimal `plugin.js`.

## End-of-call summary & analytics

When a session ends (ElevenLabs, GPT Realtime, or telephony webhook), `integrations/voice/call_finalize.py`:

- Generates a one-sentence summary (OpenAI) when the provider did not send one
- Stores **duration** and **turn count** in call metadata
- Posts the summary to the **Chat** sidebar via the chat bridge

**Voice calls** table shows Duration and Turns. **Config** page runs the voice doctor (`GET /api/voice/doctor` or `py -3.13 doctor.py`).

## MCP manager

The dashboard **MCP** page lists configured Model Context Protocol servers (`GET /api/mcp/servers`) and supports connect/disconnect from the UI.

## Phase 3 — ElevenLabs Speech Engine

Bring-your-own-LLM browser voice ([Speech Engine docs](https://elevenlabs.io/docs/overview/capabilities/speech-engine)):

```powershell
pip install -r requirements-voice.txt
# Add ELEVENLABS_API_KEY to .env
.\start_dev.ps1 -Restart
```

- **ElevenLabs talk** page — WebRTC client, token from `/api/voice/speech-engine/token`
- **Speech Engine sidecar** (`speech_engine_sidecar.py` on port **8002**) — official SDK WebSocket server
- **Dedicated tunnel** — `SPEECH_ENGINE_PUBLIC_URL` → `wss://…/ws` (separate from dashboard tunnel)
- **`setup_speech_engine.py`** — registers the public WebSocket URL with ElevenLabs

| Route | Purpose |
|-------|---------|
| `/api/voice/speech-engine/config` | Client config |
| `/api/voice/speech-engine/token` | Browser conversation token |
| `/ws` | Speech Engine WebSocket (ElevenLabs → your server) |

## Architecture

External platform handles voice pipeline (phone, STT, TTS, turn-taking). This app handles:

- **tool-calls** → PraisonAI agent tools (`integrations/voice/agent_runner.py`)
- **transcript** / **end-of-call-report** → SQLite store, SSE hub, chat bridge
- **assistant-request** → default `VOICE_ASSISTANT_ID` or dynamic inline assistant

Same pattern as `examples/python/meeting-agent` (Recall webhooks).

## Tests

```bash
pytest tests/unit/test_voice_agent.py -v
```
