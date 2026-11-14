---
name: aiui-release
description: Release the aiui package to PyPI through the GitHub pipeline and verify it from a clean venv. Use when asked to release, publish, cut a version, bump patch or minor, ship to PyPI, check why the nightly release did or did not run, or verify a published aiui version.
---

# Release aiui

Releases run only in `.github/workflows/pypi-release.yml` on `main`. The
workflow bumps `pyproject.toml` and `src/praisonaiui/__version__.py`, runs
`uv build` and `uv publish`, commits "Release vX.Y.Z" to `main`, tags it and
creates the GitHub release. Never bump, tag or publish by hand.

## 1. Preconditions

```bash
git fetch -q origin && git branch -vv | grep '^\*'
gh run list --workflow ci.yml --branch main --limit 1 --json headSha,conclusion
git rev-parse origin/main
gh run list --workflow pypi-release.yml --limit 3 --json status,conclusion,createdAt
```

- CI must be `success` on the current `origin/main` SHA.
- No release run is queued, in progress or waiting for approval.
- Never run release steps from a local branch that tracks `origin/main`:
  a plain `git push` there pushes to main. If `git branch -vv` shows
  `[origin/main]`, run `git branch --unset-upstream` first.

## 2. Dispatch

```bash
gh workflow run pypi-release.yml --ref main -f bump=patch -f dry_run=true   # preview the version
gh workflow run pypi-release.yml --ref main -f bump=patch                   # or bump=minor
```

`major` and `-f version=X.Y.Z` exist; use them only when the owner asks.

## 3. Approve the `pypi` environment

A manual dispatch uses the `pypi` environment, which has required reviewers:
the run waits at "Review deployments". The owner approves it in the Actions
UI, or:

```bash
RUN=$(gh run list --workflow pypi-release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh api repos/MervinPraison/PraisonAIUI/actions/runs/$RUN/pending_deployments --jq '.[].environment | {id, name}'
gh api -X POST repos/MervinPraison/PraisonAIUI/actions/runs/$RUN/pending_deployments \
  -F 'environment_ids[]=<id>' -f state=approved -f comment='release'
gh run watch $RUN
```

Approve only when the user has asked for this release.

## 4. Verify on PyPI from a clean venv

```bash
cd "$(mktemp -d)" && python3 -m venv .venv && . .venv/bin/activate
pip install -q --no-cache-dir aiui==X.Y.Z
aiui --version                           # praisonaiui version X.Y.Z
cat > app.py <<'EOF'
import praisonaiui as aiui

@aiui.reply
async def on_message(message):
    await aiui.say(f"echo: {message}")
EOF
aiui run app.py --port 18911 > open.log 2>&1 &                     # open server
AUTH_ENFORCE=true aiui run app.py --port 18931 > enforced.log 2>&1 &
sleep 8   # wait for "Uvicorn running" in both logs
curl -s localhost:18911/health; echo                                # {"status":"ok",...}
curl -s -o /dev/null -w '%{http_code}\n' localhost:18911/api/pages  # 200
curl -s -o /dev/null -w '%{http_code}\n' localhost:18931/api/pages  # 401
curl -s -o /dev/null -w '%{http_code}\n' localhost:18931/health     # 200
pkill -f 'aiui run app.py --port 189'
```

`aiui run` moves to the next port when the requested one is busy and prints
the URL it used; read it from the banner, or a different server answers your
curl. Then `git fetch` so the local `main` has the "Release vX.Y.Z" commit.

## Nightly release gate

`.github/workflows/nightly-release-gate.yml` runs after every green CI push
to `main` and at 00:00 UTC. Its preflight (`.github/scripts/release-gate.js`)
dispatches a **patch** release on the `pypi-auto` environment (no approval)
only when all hold:

- no release run is active or awaiting approval;
- no successful release run yet today (UTC), manual ones included: one per day;
- the next patch version is not on PyPI;
- `src/praisonaiui`, `src/frontend` or `pyproject.toml` changed since the last `v*` tag;
- CI is green on the evaluated SHA (and, for a CI trigger, it is still `origin/main`).

The run summary prints the skip reason. A dry run:
`gh workflow run nightly-release-gate.yml --ref main -f dry_run=true`.
Minor and major releases are always manual.
