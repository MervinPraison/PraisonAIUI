"""A built docs site behind AUTH_ENFORCE, for e2e/specs/docs-auth.spec.ts.

What `aiui run --config` serves (create_app(static_dir=<built site>), style
docs) with AUTH_ENFORCE=true and one API key, E2E_DOCS_KEY. Started by
fixtures/start-server.mjs --docs-auth.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

E2E_DOCS_KEY = "e2e-docs-key"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--site", required=True)
    args = parser.parse_args()

    os.environ["AUTH_ENFORCE"] = "true"
    import uvicorn

    from praisonaiui.features import auth as feature_auth
    from praisonaiui.server import create_app, set_style

    set_style("docs")
    app = create_app(static_dir=Path(args.site))
    feature_auth._auth_config["api_keys"][E2E_DOCS_KEY] = {"name": "e2e"}
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
