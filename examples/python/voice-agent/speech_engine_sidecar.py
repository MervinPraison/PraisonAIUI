"""Standalone ElevenLabs Speech Engine WebSocket server (port 8002).

ElevenLabs connects here for transcripts; the dashboard stays on 8001.
Official SDK path: engine.serve() — more reliable than in-app Starlette /ws.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in __import__("sys").path:
    __import__("sys").path.insert(0, str(_ROOT))


def _load_env() -> None:
    env_path = _ROOT / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if key:
            os.environ[key] = value


async def _main() -> None:
    _load_env()
    api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
    engine_id = os.getenv("SPEECH_ENGINE_ID", "").strip()
    port = int(os.getenv("SPEECH_ENGINE_PORT", "8002"))
    disable_auth = os.getenv("SPEECH_ENGINE_DISABLE_AUTH", "").lower() in (
        "1",
        "true",
        "yes",
    )

    if not api_key or not engine_id:
        raise SystemExit("Set ELEVENLABS_API_KEY and SPEECH_ENGINE_ID in .env")

    from elevenlabs import AsyncElevenLabs

    from integrations.voice.speech_engine import (
        handle_session_close,
        handle_session_disconnect,
        handle_session_init,
        handle_user_transcript,
    )

    client = AsyncElevenLabs(api_key=api_key)
    engine = await client.speech_engine.get(engine_id)

    async def on_transcript(transcript, session):  # noqa: ANN001
        await handle_user_transcript(transcript, session)

    async def on_init(conversation_id, session):  # noqa: ANN001
        await handle_session_init(conversation_id, session)

    async def on_close(session):  # noqa: ANN001
        await handle_session_close(session)

    async def on_disconnect(session):  # noqa: ANN001
        await handle_session_disconnect(session)

    async def on_error(err, session):  # noqa: ANN001
        print(f"[speech sidecar] error: {err}", flush=True)

    debug = os.getenv("SPEECH_ENGINE_DEBUG", "true").lower() in ("1", "true", "yes")
    print(f"[speech sidecar] listening on ws://127.0.0.1:{port}/ws (debug={debug})", flush=True)
    await engine.serve(
        port=port,
        path="/ws",
        debug=debug,
        disable_auth=disable_auth,
        on_init=on_init,
        on_transcript=on_transcript,
        on_close=on_close,
        on_disconnect=on_disconnect,
        on_error=on_error,
    )


if __name__ == "__main__":
    asyncio.run(_main())
