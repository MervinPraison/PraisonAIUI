"""CLI for voice-agent stack diagnostics."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

_EXAMPLE_DIR = Path(__file__).resolve().parent
if str(_EXAMPLE_DIR) not in sys.path:
    sys.path.insert(0, str(_EXAMPLE_DIR))


def _load_local_env() -> None:
    env_path = _EXAMPLE_DIR / ".env"
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


def main() -> int:
    _load_local_env()
    from integrations.voice.doctor import run_voice_doctor

    app_port = int(os.getenv("VOICE_AGENT_PORT", "8001"))
    sidecar_port = int(os.getenv("SPEECH_ENGINE_SIDECAR_PORT", "8002"))
    report = run_voice_doctor(app_port=app_port, sidecar_port=sidecar_port)
    print(json.dumps(report, indent=2))
    return 1 if report["summary"]["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
