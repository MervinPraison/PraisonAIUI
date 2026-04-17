---
description: Publish and release praisonaiagents + praisonai to PyPI (default = hotfix patch)
---
// turbo-all

# Publish & Release Workflow

End-to-end publish pipeline for the PraisonAI stack. **Default release type is a hotfix (patch) bump.** Only three commands are needed — each does the heavy lifting. The wrapper is uploaded to PyPI automatically by GitHub Actions once the release is created.

## Packages & version rules

| Package | Canonical path | Current family |
|---|---|---|
| `praisonaiagents` (Core SDK) | `/Users/praison/praisonai-package/src/praisonai-agents` | `1.6.x` |
| `praisonai` (Wrapper) | `/Users/praison/praisonai-package/src/praisonai` | `4.6.x` |

- Wrapper **major.minor** tracks the SDK: SDK `1.6.x` ↔ wrapper `4.6.x`.
- **Patch numbers must match** across both packages for the same release (SDK `1.6.9` ↔ wrapper `4.6.9`).
- Working branch: `main` — push directly, no feature branches.

## Prerequisites

- PyPI token in `/Users/praison/.pypirc` under `[pypi].password` (format `pypi-...`).
- `gh` CLI authenticated (`gh auth status`).
- Working tree on `main` with the code change already in place (uncommitted is fine — step 2 will auto-commit).

Export the PyPI token once for the session:
```bash
export PYPI_TOKEN=$(python3 -c "import configparser;c=configparser.ConfigParser();c.read('/Users/praison/.pypirc');print(c['pypi']['password'])")
```

---

## STEP 1 — Publish `praisonaiagents` (Core SDK)

**`praisonai publish pypi` run from inside `praisonai-agents/` automatically:**
1. Reads the current version from `pyproject.toml`
2. Auto-bumps the **patch** number (default; use `--minor` / `--major` to override)
3. Runs `rm -rf dist && uv lock && uv build && uv publish --token $PYPI_TOKEN`
4. Publishes the package to PyPI

// turbo
```bash
cd /Users/praison/praisonai-package/src/praisonai-agents
praisonai publish pypi
```

Bump variants (optional):
- `praisonai publish pypi --minor` → `1.6.9 → 1.7.0`
- `praisonai publish pypi --major` → `1.6.9 → 2.0.0`
- `praisonai publish pypi --no-bump` → publish current version
- `praisonai publish pypi --dry-run` → preview without executing

Verify:
```bash
pip index versions praisonaiagents | head -1
```

> Note the new SDK version (e.g. `1.6.9`) — you'll need it in step 3.

---

## STEP 2 — Auto-commit the version bump

**`praisonai commit -a` automatically:**
1. Stages all changes (`-a`)
2. Generates an AI commit message
3. Creates the commit

Add `-p` / `--push` to also push to origin in one shot.

// turbo
```bash
cd /Users/praison/praisonai-package
praisonai commit -a -p
```

Equivalent flags:
- `praisonai commit -a` — commit only
- `praisonai commit -a -p` — commit + push (recommended for releases)
- `praisonai commit -a -m "chore: bump praisonaiagents to 1.6.9"` — custom message

---

## STEP 3 — Bump + release `praisonai` (Wrapper)

**`python scripts/bump_and_release.py <WRAP_VERSION> --agents <AGENTS_VERSION> --wait` automatically:**
1. Waits for the SDK version to propagate on PyPI (`--wait`)
2. Updates every version file:
   - `src/praisonai/praisonai/version.py`
   - `src/praisonai/praisonai/deploy.py`
   - `src/praisonai/pyproject.toml` (wrapper version + `praisonaiagents` dependency)
   - `docker/Dockerfile{,.chat,.dev,.ui}`
   - `src/praisonai/praisonai.rb` (Homebrew formula)
3. Copies root `README.md` into the package
4. Runs `uv cache clean → uv lock → uv build`
5. Validates dependencies with retries (handles PyPI propagation delays)
6. `git add -A && git commit -m "Release vX.Y.Z"`
7. Creates & force-pushes tag `vX.Y.Z`
8. `git pull --rebase origin main && git push && git push --tags -f`
9. `gh release create vX.Y.Z --latest` → this triggers the `.github/workflows/python-publish.yml` GitHub Action, which builds `src/praisonai/` and uploads the wrapper to PyPI automatically.

**Version rule:** wrapper patch = SDK patch. If SDK became `1.6.9`, wrapper becomes `4.6.9`.

```bash
cd /Users/praison/praisonai-package/src/praisonai
python scripts/bump_and_release.py 4.6.9 --agents 1.6.9 --wait
```

Template:
```bash
python scripts/bump_and_release.py <WRAP_VERSION> --agents <AGENTS_VERSION> --wait
```

Useful flags:
- `--wait` — poll PyPI until `praisonaiagents==<AGENTS_VERSION>` is visible (recommended right after step 1)
- `--auto` — auto-detect latest `praisonaiagents` from PyPI (use instead of `--agents`)
- `--no-add-all` — only stage the known release files (safer if you have unrelated WIP)
- `--force` — skip pre-flight checks

> ✅ The script creates the GitHub release, and the `.github/workflows/python-publish.yml` Action automatically uploads the wrapper to PyPI. **No manual `uv publish` needed.**

Watch the Action run:
```bash
gh run watch --exit-status --repo MervinPraison/PraisonAI
```

---

## Post-release checks

// turbo
```bash
pip index versions praisonaiagents | head -1
pip index versions praisonai | head -1                 # may take ~1–2 min for GH Actions to publish
gh release view v<WRAPPER_VERSION> --json tagName,isLatest,url
gh run list --workflow=python-publish.yml --limit 3
cd /Users/praison/praisonai-package && git log --oneline -5
```

---

## One-shot hotfix (copy/paste)

Replace `AGENTS_NEW` and `WRAP_NEW` with the next patch pair (same last number):

```bash
export PYPI_TOKEN=$(python3 -c "import configparser;c=configparser.ConfigParser();c.read('/Users/praison/.pypirc');print(c['pypi']['password'])")

# 1. Publish SDK (auto-bumps patch, builds, uploads to PyPI)
cd /Users/praison/praisonai-package/src/praisonai-agents
praisonai publish pypi

# 2. Auto-commit + push the SDK version bump
cd /Users/praison/praisonai-package
praisonai commit -a -p

# 3. Bump + tag + release the wrapper. GitHub Actions publishes it to PyPI.
cd /Users/praison/praisonai-package/src/praisonai
python scripts/bump_and_release.py WRAP_NEW --agents AGENTS_NEW --wait

# 4. Verify (wait ~1–2 min for GH Actions python-publish workflow to finish)
pip index versions praisonaiagents | head -1
pip index versions praisonai | head -1
```

Concrete example (`1.6.9` / `4.6.9`):
```bash
cd /Users/praison/praisonai-package/src/praisonai-agents && praisonai publish pypi
cd /Users/praison/praisonai-package && praisonai commit -a -p
cd /Users/praison/praisonai-package/src/praisonai && python scripts/bump_and_release.py 4.6.9 --agents 1.6.9 --wait
```

---

## Troubleshooting

- **`uv publish` 403 / missing token (SDK step only)** — `PYPI_TOKEN` not exported; re-run the `export PYPI_TOKEN=…` line from Prerequisites.
- **Wrapper didn't appear on PyPI** — the GH Action may have failed. Check it:
  ```bash
  gh run list --workflow=python-publish.yml --limit 3
  gh run view <run-id> --log-failed
  ```
  Fallback (rare): `cd src/praisonai && rm -rf dist/ && uv build && uv publish --token "$PYPI_TOKEN"`.
- **`gh release create` fails inside `bump_and_release.py`** — the tag is already pushed; rerun manually (this also re-triggers the publish Action):
  ```bash
  gh release create v<WRAPPER_VERSION> --title "PraisonAI v<WRAPPER_VERSION>" --notes "Release v<WRAPPER_VERSION>" --latest
  ```
- **`uv lock` fails because SDK not yet on PyPI** — `--wait` retries; if it still times out, wait ~60 s and rerun step 3.
- **Wrong branch** — releases must ship from `main`. Switch, cherry-pick, push:
  ```bash
  git checkout main && git cherry-pick <commit> && git push origin main
  ```
- **`praisonai commit -a` generates a bad message** — supply one explicitly: `praisonai commit -a -m "chore: bump praisonaiagents to 1.6.9" -p`.

---

## Rules

- ALWAYS publish the **SDK first**, then the wrapper (the wrapper pins the SDK version).
- ALWAYS keep the **patch number identical** across both packages.
- ALWAYS release from `main` — never a feature branch.
- ALWAYS use `--wait` in step 3 so the wrapper's `uv lock` can resolve the new SDK.
- ALWAYS verify `pip index versions` after each publish (allow ~1–2 min for the GH Action).
- NEVER edit `version.py`, Dockerfiles, or `praisonai.rb` by hand — `bump_and_release.py` owns them.
- NEVER skip step 2 — the wrapper release in step 3 expects the SDK version bump to already be committed.
- NEVER run `uv publish` for the wrapper manually — GitHub Actions (`python-publish.yml`) owns that step.

---

## Resources

- **Repository**: https://github.com/MervinPraison/PraisonAI
- **Documentation**: https://docs.praison.ai
- **Website**: https://praison.ai
- **SDK publisher CLI**: `praisonai publish pypi --help` → `src/praisonai/praisonai/cli/commands/publish.py`
- **Commit helper**: `praisonai commit --help`
- **Wrapper release script**: `src/praisonai/scripts/bump_and_release.py`
- **Wrapper PyPI publish Action**: `.github/workflows/python-publish.yml` (triggers on `release: published`)
