#!/usr/bin/env bash
# Set up (or update) the pre-QA host from this directory: tool venv, Chromium,
# user services. Run on the host as the service user, from tools/preqa:
#   ./install.sh            install + start      ./install.sh --no-start   files only
set -euo pipefail
HOME_DIR="${PREQA_HOME:-$HOME/preqa}"
TOOL="$HOME_DIR/tool"
UV="$(command -v uv || echo "$HOME/.local/bin/uv")"
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$HOME_DIR"/{history,dashboard,sites} "$HOME/.config/systemd/user"
if [ "$here" != "$TOOL" ]; then rm -rf "$TOOL" && cp -r "$here" "$TOOL"; fi
[ -x "$HOME_DIR/venv-tool/bin/python" ] || "$UV" venv --quiet --python 3.11 "$HOME_DIR/venv-tool"
VIRTUAL_ENV="$HOME_DIR/venv-tool" "$UV" pip install --quiet -r "$TOOL/requirements.txt"
"$HOME_DIR/venv-tool/bin/python" -m playwright install chromium-headless-shell chromium >/dev/null
# node (for the deploy's carry-forward step) and uv on the services' PATH
NODE_BIN="$(dirname "$(command -v node 2>/dev/null || true)")"
if [ -z "$NODE_BIN" ] || [ "$NODE_BIN" = "." ]; then
  NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | tail -1 || true)"
fi
[ -f "$HOME_DIR/env" ] || echo "PATH=$NODE_BIN:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" > "$HOME_DIR/env"
cp "$TOOL"/systemd/*.service "$TOOL"/systemd/*.timer "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
if [ "${1:-}" != "--no-start" ]; then
  systemctl --user enable --now preqa-serve.service preqa-poll.timer preqa-track.timer
fi
systemctl --user --no-pager list-timers 'preqa-*' || true
