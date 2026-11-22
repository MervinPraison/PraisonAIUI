# Pre-QA environment and performance tracker

Internal tooling, not part of the `aiui` wheel or the frontend bundle. It builds
the docs site from `main` (or any branch or PR) on a private host, serves it the
way GitHub Pages serves https://ui.praison.ai, and runs headless browser checks
against **both** pre-QA and production on every build and every 30 minutes.
A run that breaks a budget is **FAILED**: the command exits 1, the failure is
listed first in the output and at the top of the dashboard, and one
notification goes out per new failure.

```
tools/preqa/
  budgets.json        fail-fast budgets (edit to tighten or loosen)
  requirements.txt    Playwright pin (the tracker's only dependency)
  install.sh          set up / update the host: venvs, Chromium, user services
  systemd/            preqa-serve (site + dashboard), preqa-poll (5 min), preqa-track (30 min)
  dashboard/          index.html, served at /preqa/, reads report.json
  preqa/              python -m preqa {serve,build,poll,track,report}
```

Each module stands alone: `serve` is a static server, `budgets` / `history` /
`report` / `notify` are stdlib, `track` is the only part that needs Playwright.

## Open it

The host binds 127.0.0.1 only. Forward the port, then open the site and the dashboard:

```bash
ssh -L 8700:127.0.0.1:8700 massedcomputemain
# site:      http://127.0.0.1:8700/
# dashboard: http://127.0.0.1:8700/preqa/
# raw runs:  http://127.0.0.1:8700/preqa/history/runs-YYYY-MM.jsonl
```

## Host layout (`$PREQA_HOME`, default `~/preqa`)

| Path | What |
|---|---|
| `tool/` | this directory (copied by `install.sh`) |
| `repo/` | read-only https clone; fetch only, never pushed, no credentials |
| `venv-build/`, `venv-tool/` | `aiui` for builds; Playwright for the tracker |
| `builds/<name>-<sha>/`, `sites/<name>` | built sites; `sites/main` is what port 8700 serves |
| `history/runs-YYYY-MM.jsonl` | one JSON line per target per run (timestamp, sha, metrics, breaches, issues) |
| `history/builds.jsonl`, `notifications.jsonl`, `notify-state.json` | build log, sent notices, dedupe state |
| `dashboard/` | `index.html` + `report.json` |
| `env` | PATH for the services (node for the carry-forward step) |

Install or update: copy this directory to the host (`COPYFILE_DISABLE=1 tar --no-xattrs -czf - tools/preqa | ssh host 'tar -xzf - -C /tmp'`) and run `./install.sh` there. Status: `systemctl --user list-timers 'preqa-*'`, logs: `journalctl --user -u preqa-poll -n 50`.

## Builds

`python -m preqa build --ref main` does what the Pages deploy does: `aiui build
--minify`, `aiui schema`, then `carry-forward-assets.mjs` with the previous
build, and switches `sites/main` to the new build atomically. The poll timer
runs `python -m preqa poll --track`: when `origin/main` has a new commit it
builds and then tracks. A failed build is recorded as a FAILED run.

Branches and PRs: `python -m preqa build --ref pr/123` (or `--ref my-branch`)
builds into `sites/pr-123`; serve it on another port and track it:

```bash
python -m preqa serve --site ~/preqa/sites/pr-123 --port 8701 &
python -m preqa track --target pr-123=http://127.0.0.1:8701 --target prod=https://ui.praison.ai
```

## What a run measures

All timings are read inside the page (`probe.js`). "First content" is the
moment `#main-content h1` is on screen and no `.aiui-docs-skeleton` is left.

| Metric | Flow |
|---|---|
| `first_content_cold_ms`, `first_content_warm_ms`, `reload_ms` | each page in `track.PAGES`: new profile, same profile again, reload |
| `nav_ms`, `back_forward_ms` | sidebar click-through waiting for each page; then back and forward |
| `hover_nav_ms` | hover a link 400 ms (prefetch), then click |
| `rapid_final_ms` | click 6-8 links 120 ms apart; the last one must show |
| `search_open_ms`, `search_query_ms` | Ctrl+K, type "install", wait for a matching result |
| `two_tabs_ms` | the same deep page opened in two tabs of one profile at once |
| `bytes.*`, `requests.*` | JS / CSS / font / JSON / markdown / HTML transferred on a cold load (largest page) |
| `held_requests` | same-origin request held > 1 s before reaching the network (`requestStart` 0, or queued > 1 s after DNS + connect) |
| `stalled_requests` | request over 5 s, or still open when its flow ends |
| `failed_requests`, `console_errors` | network failures and HTTP >= 400 (navigation aborts excluded); console errors and page errors |
| `skeleton_max_ms`, `skeleton_over_3s` | longest loading-skeleton stretch; stretches over 3 s |
| `content_timeouts` | content never appeared within 20 s |
| `docs_load_*` | the app's `aiui:docs-load` events (`window.__aiuiDocsLoad`, the DOM event, or console lines), when the build emits them; `docs_load_problems` counts outcomes other than ok or inline (Markdown inlined in the page HTML) |

Each issue (held, stalled, failed, skeleton, timeout, console) is stored with
its URL, flow and time, and listed on the dashboard.

## Budgets

`budgets.json` maps a dotted metric path to `{"max": n}` and/or `{"min": n}`.
A metric missing from a run is a breach unless the rule says
`"required": false`, so a check that silently stops measuring fails. Rules under
`targets.<name>` override the defaults for one target (`null` removes one).
`ignore.failed` / `ignore.console` take regexes for known noise.
`--fail-fast` stops a target at its first breach.

## Notifications

One message per new failure (`target:metric`), none while it stays failing,
a new one after it recovers and breaks again. Slack is used only when
`SLACK_BOT_TOKEN` and `SLACK_CHANNEL` are set in the environment; the pre-QA
host holds no secrets, so there the messages go to `history/notifications.jsonl`
and the failures show on the dashboard.

## In CI (not wired yet)

The same checks run against any served build. A job would:

```bash
pip install -e . && pip install -r tools/preqa/requirements.txt
python -m playwright install --with-deps chromium
aiui build --output site --minify
(cd tools/preqa && python -m preqa serve --site ../../site --port 8700 &)
cd tools/preqa && python -m preqa track --target preqa=http://127.0.0.1:8700 \
  --runs 2 --fail-fast --history "" --out preqa-run.json   # exit 1 on a breach
```

Shared runners are noisier than the pre-QA host; give the CI target its own
looser timing rules under `targets` and keep the byte and count budgets strict.

## Tests

`pytest tests/unit/test_preqa_tools.py` (budgets, history parsing, report,
notifications, server) and `ruff check tools/preqa`.
