"""Server for e2e/specs/layouts-host.spec.ts.

The suite's mock server (``../mock_server.py``: the real ``create_app()``
with a scripted provider) in the app shell, with this folder's third-party
layout plugin (``aiui_layout_fixture``) registered in-process.

    python serve.py --port 9040

Isolated like ``start-server.mjs``: a fresh temp ``AIUI_DATA_DIR`` and
``HOME``, provider keys and tokens removed, entry-point autoload off, and the
current ``dist/`` build served through ``AIUI_TEMPLATES_DIR`` (run
``npm run build`` first).
"""

from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent
FRONTEND = FIXTURES.parents[1]
REPO = FRONTEND.parents[1]


def _isolate(work: Path) -> None:
    for key in list(os.environ):
        if key.endswith(("_API_KEY", "_TOKEN")):
            del os.environ[key]
    data, home, templates = work / "data", work / "home", work / "frontend"
    data.mkdir(parents=True)
    home.mkdir(parents=True)
    sync = subprocess.run(
        ["node", str(FRONTEND / "scripts" / "sync-templates.mjs"), "--dest", str(templates)],
        stdout=subprocess.DEVNULL,
        check=False,
    )
    if sync.returncode != 0:
        sys.exit("serve.py: could not copy dist/ (run `npm run build` in src/frontend first)")
    os.environ.update(
        {
            "AIUI_DATA_DIR": str(data),
            "HOME": str(home),
            "USERPROFILE": str(home),
            "AIUI_TEMPLATES_DIR": str(templates),
            "AIUI_DISABLE_PLUGIN_AUTOLOAD": "1",
            "AIUI_SHELL": "app",
            "PYTHONUNBUFFERED": "1",
        }
    )


def main() -> None:
    if "--port" not in sys.argv:
        sys.exit("usage: serve.py --port <n>")
    port = sys.argv[sys.argv.index("--port") + 1]
    # Playwright stops this server with SIGTERM. Python's default action ends the
    # process without running `finally`, which leaked one work folder per run;
    # raising SystemExit instead runs the cleanup below.
    for sig in (signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, lambda *_: sys.exit(0))
    work = Path(tempfile.mkdtemp(prefix="aiui-e2e-layouts-"))
    try:
        _isolate(work)
        sys.path[:0] = [str(REPO / "src"), str(FIXTURES), str(HERE)]
        import mock_server  # noqa: E402  (after the environment is isolated)
        from aiui_layout_fixture import plugin  # noqa: E402

        import praisonaiui as aiui  # noqa: E402

        aiui.register_plugin(plugin)
        sys.argv = [str(FIXTURES / "mock_server.py"), "--port", port]
        mock_server.main()
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
