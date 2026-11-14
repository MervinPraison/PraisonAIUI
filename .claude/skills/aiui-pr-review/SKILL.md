---
name: aiui-pr-review
description: Review a PraisonAIUI pull request or branch diff against ARCHITECTURE.md rule by rule, citing rule numbers, running the relevant gates and flagging scope creep and server.py growth. Use when asked to review a PR, a diff or a branch in this repo, to act as the FINAL reviewer, or to check whether a change is ready to merge.
---

# Review a PraisonAIUI PR

The contract is `ARCHITECTURE.md`: rules R1-R16 in §3 and the checklist in §6.
`prd.md` holds the product non-goals. Cite rule numbers, not opinions.

## 1. Get the diff and its size

```bash
gh pr view <N> --json title,body,labels,additions,deletions,changedFiles,headRefName
gh pr diff <N> --name-only
gh pr checkout <N>        # or work in a worktree on the PR branch
git diff --stat origin/main...HEAD
```

## 2. Walk the checklist

Go through `ARCHITECTURE.md` §6 items 1-13 in order. For each, read the
changed files it concerns. Quick checks:

| Rule | Look for |
|---|---|
| R15 scope | more than 800 added lines or 30 files; `.github/workflows/`, `pyproject.toml`, `credentials.json`; more than one domain; a knob, export or param with no live consumer |
| R1 core purity | page ids, group names or feature imports in `src/frontend/src/{shell,sdk,legacy,blocks}/`; entries added to `KNOWN_DEBT` in `shell/core-purity.test.ts` |
| R2/R3 plugin model | a page or feature without a `builtin/catalog.py` record; a new registry, `window.*` hook or per-kind list; new code on a legacy adapter |
| R4/R10 laziness | static imports of Streamdown, Shiki, Mermaid, KaTeX, `@assistant-ui`; top-level imports of optional Python deps (`httpx`, `litellm`, provider SDKs) |
| R5/R7 contracts | `SDK_EXPORTS`/`SDK_FEATURES` edited other than by appending; removed or renamed public Python names, YAML keys, `/api/*` paths, events |
| R6 default | changes to `tests/unit/fixtures/golden_dashboard_html.txt` or `builtin_pages_snapshot.json` without a stated reason |
| R8/R9 security | new `Route(`/WebSocket without auth in every mode; new `mark_public`; `innerHTML`, `dangerouslySetInnerHTML`; a new rehype list or `allowedTags` |
| R11 server.py | see step 3 |
| R12 tests | Python product code without a test change; visible UI without an e2e spec |
| R13 bundle | `src/frontend/**` changed but `src/praisonaiui/templates/frontend/` not, or hand-edited `assets/` |
| R14 design | hex, `rgb()`, raw palette classes, `h-*`/`px-*` overrides on primitives, emoji in UI chrome, missing `aria-label` |
| R16 docs | a rule, API, token or budget change with no doc update; planned work written as done |

```bash
git diff origin/main...HEAD | grep -nE 'innerHTML|dangerouslySetInnerHTML|mark_public|allowedTags|#[0-9a-fA-F]{6}\b'
```

## 3. server.py growth (R11)

```bash
git diff origin/main...HEAD -- src/praisonaiui/server.py | grep -cE '^\+.*\b(Route|Mount|WebSocketRoute)\('
grep -A6 '^def create_app' src/praisonaiui/server.py   # params stay: config, static_dir, require_auth, config_path
git diff --numstat origin/main...HEAD -- src/praisonaiui/server.py   # added vs removed lines
```

Any new route, `create_app` parameter or module-level feature state is a
finding. Net growth without a stated reason is a finding; moving code out is fine.

## 4. Run the gates that apply

Run only what the diff touches (commands in the `aiui-change` skill, step 5):
Python files, `ruff check src/praisonaiui` and `pytest tests/unit -q --no-cov`;
frontend files, `npx tsc -b`, `npm test`, `npm run build`, `npm run size`,
`npm run check:closure`, `npm run check:bundle`. Also read the PR's CI status:
`gh pr checks <N>`.

## 5. Output

One finding per line, most severe first, then the gates you ran:

```text
BLOCK R11 src/praisonaiui/server.py:812 new Route("/api/foo") in create_app -> move to features/foo.py owned by a catalog record
MAJOR R12 src/praisonaiui/features/foo.py:40 new logic has no test -> add tests/unit/test_foo.py
MINOR R14 src/frontend/src/builtin/foo/FooPage.tsx:22 text-gray-500 -> text-muted-foreground
Gates: ruff ok; pytest tests/unit 1 failed (test_foo_auth); npm run size ok
Verdict: request changes (1 blocker)
```

Severity: BLOCK (rule violated, must fix), MAJOR (should fix before merge),
MINOR (fix or follow up). No praise lines and no restating the diff. If
nothing is wrong, say so in one line and list the gates run.
