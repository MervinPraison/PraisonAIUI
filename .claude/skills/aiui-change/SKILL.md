---
name: aiui-change
description: Make a code change to PraisonAIUI end to end, from choosing the extension point to opening the PR. Use when asked to add or fix a page, feature, route, plugin, chat or shell behaviour, theme or build script in this repo, or to "implement", "fix", "add" or "ship" anything under src/praisonaiui, src/frontend or tests.
---

# Make a change to PraisonAIUI

Facts live in `AGENTS.md` and `ARCHITECTURE.md` on `main`. If this file and
they disagree, they win; fix this file in the same PR.

## 1. Branch in a worktree

```bash
git fetch -q origin
git worktree add --no-track -b <type>/<short-name> <path> origin/main
cd <path> && git branch -vv | grep '^\*'   # no [origin/main] upstream
```

Never commit to or push `main`.

## 2. Pick the extension point

Find the row in the "Extension Points" table in `AGENTS.md`, then read the
rules it names in `ARCHITECTURE.md` §3. Defaults:

- First-party page or feature: a `BuiltinPlugin` record in `src/praisonaiui/builtin/catalog.py`, plus `src/frontend/src/builtin/index.ts` if it has React code (R2).
- Backend API: a `features/*.py` module owned by a catalog record, or a plugin's `routes()`. Never a new `Route(` or parameter in `create_app` (R11).
- Browser UI: `@aiui/sdk` (`registerPage`, `registerBlock`, `registerSlot`, `registerCommand`). No new registry or `window.*` hook (R3).
- Legacy vanilla views (`templates/frontend/plugins/views/*.js`): fixes only, no new views.

## 3. Check the rules that apply

Walk `ARCHITECTURE.md` §6 (PR review checklist) before writing code. The ones
most often missed:

- R1: no page id or group name in `shell/`, `sdk/`, `legacy/`, `blocks/`.
- R4/R10: heavy code behind `import()`/`React.lazy`; optional Python deps imported inside functions.
- R6: `dashboard` output stays byte-for-byte (golden HTML test).
- R8/R9: every route and WebSocket authenticated in all three auth modes; escape untrusted text.
- R14: tokens and primitives only (see the `aiui-design` skill).

## 4. Write the tests

Use R12's table: pytest in `tests/unit/` for Python logic (the merge gate
requires a test change with new Python product code), colocated
`*.test.ts(x)` for browser logic, a Playwright spec in
`src/frontend/e2e/specs/` for visible behaviour, a `test_http_guard.py`-style
test for auth and routes.

## 5. Run the gates

Python (repo root):

```bash
pip install -e ".[dev]"
ruff check src/praisonaiui
pytest tests/unit -q --no-cov --timeout=60
pytest tests/integration/test_agentic_roundtrip.py tests/test_feature_sdk_backends.py -q --no-cov --timeout=120
```

Frontend (only when `src/frontend/**` changed; Node from `src/frontend/.nvmrc`):

```bash
cd src/frontend && npm ci
npx tsc -b && npm run typecheck:e2e
npm test && npm run test:scripts
npx eslint src/shell src/chat-engine src/markdown src/legacy src/sdk src/blocks src/builtin e2e
npm run build && npm run size && npm run check:closure
npm run sync && npm run check:bundle
```

Commit `src/praisonaiui/templates/frontend/` with the source change (R13).
Never hand-edit files under `templates/frontend/assets/`. CI runs the
Playwright suites (`npm run test:e2e` locally, after a build).

Report each command you ran and its result. Do not say "done" on a gate you
did not run.

## 6. Keep the PR within auto-merge limits

Check before pushing:

```bash
git diff --shortstat origin/main...HEAD    # at most 800 insertions, 30 files
git diff --name-only origin/main...HEAD | grep -E '^\.github/workflows/|^pyproject\.toml$|credentials\.json$'
```

Any hit on the second command, or the labels `security`, `breaking-change`,
`needs-manual-review`, `release`, `no-auto-merge`, means a manual merge (R15,
`.github/scripts/gate-config.js`). Split larger work into stacked PRs, one
domain each. Update docs in the same PR (R16).

## 7. Open the PR

```bash
git branch -vv | grep '^\*'                 # upstream must not be origin/main
git push -u origin <type>/<short-name>
gh pr create --base main --title "<type>: <summary>" --body "<what, why, gates run>"
```

The pipeline then runs CI, the review chain (CodeRabbit and Greptile, then a
FINAL `@claude` review against `ARCHITECTURE.md`) and the merge gate, which
merges when everything is green. Fix review findings on the same branch; do
not open a second PR for them.
