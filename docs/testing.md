# Testing

> How the PraisonAIUI test suites are laid out and how to run them. To test a

How the PraisonAIUI test suites are laid out and how to run them. To test a
running server from the outside, see [API Testing](https://ui.praison.ai/docs/api/testing.md).

## Python tests

```bash
pip install -e ".[dev]"

pytest tests/unit -v                        # fast, isolated
pytest tests/unit tests/integration -v      # everything
pytest tests/unit tests/integration -v --cov=src/praisonaiui --cov-report=term-missing
```

CI runs `ruff check src/praisonaiui`, then
`pytest tests/unit tests/integration -v --no-cov --timeout=120`. Tests marked `live` call a real LLM
provider and skip unless `PRAISONAI_LIVE_TESTS=1`; `tests/integration/conftest.py`
clears provider API keys for the others. The Python suites that need Node
22.15+, `src/frontend/node_modules` or Chromium run in e2e shard 1 with
`RUN_BROWSER_TESTS=1` and `--fail-on-skip`, which fails the run if any test
skips (see `tests/README.md`).

| Folder | What is in it |
|--------|---------------|
| `tests/unit/` | Isolated tests: schema, compiler, docs scanner, serve, server and app-shell manifest, plugins, CLI, each feature. They use `tmp_path` and Starlette's `TestClient`, and start no server |
| `tests/unit/fixtures/` | Golden files, such as the default dashboard HTML and the built-in page snapshot |
| `tests/integration/` | End-to-end tests: the `validate → build → serve` pipeline through Typer's `CliRunner`, endpoints, agentic round trips, attachments. Some need `praisonaiagents` or an API key and skip without them |
| `tests/` (top level) | Feature-level tests for each domain API |

The suites grow with every change, so count them instead of trusting a
number written here:

```bash
pytest tests/unit --collect-only -q | tail -1
```

## Frontend tests

From `src/frontend` (Node version in `.nvmrc`):

```bash
npm ci
npx tsc -b                 # type-check
npm test                   # unit tests (src/**/*.test.ts(x))
npm run test:scripts       # build-script tests
npm run build
npm run size               # gzip budgets
npm run check:closure      # heavy libraries stay out of the first screen
npm run check:bundle       # committed bundle matches a fresh build
```

## Browser tests

Playwright suites in `src/frontend/e2e/` start real servers (with a scripted
provider instead of a model) and drive Chromium against the default
dashboard, the app shell, the chat style, the docs site and the layouts.
They serve `dist/`, so build first:

```bash
cd src/frontend
npm run build
npx playwright install chromium
npm run test:e2e
```

The projects, servers and baselines are described in
[`src/frontend/e2e/README.md`](https://github.com/MervinPraison/PraisonAIUI/blob/main/src/frontend/e2e/README.md).

## Manual checks for a docs site

| Check | How | Expected |
|-------|-----|----------|
| Site loads | `aiui build && aiui serve` | Page renders, the sidebar navigates, the table of contents lists the headings |
| Path traversal | `curl --path-as-is 'http://127.0.0.1:8000/%2e%2e/etc/passwd'` | Not served (404) |
| Cross-origin | `curl -sI -H 'Origin: http://evil.com' http://127.0.0.1:8000/` | No `Access-Control-*` headers |
| HTTPS | `aiui serve --ssl-certfile cert.pem --ssl-keyfile key.pem` | An `https://` URL is printed |

## Where to add a test

Every change ships with a test (rule R12 in
[ARCHITECTURE.md](https://github.com/MervinPraison/PraisonAIUI/blob/main/ARCHITECTURE.md)).
A Python change goes in `tests/unit/`, a CLI pipeline change in
`tests/integration/test_cli.py`, a React change next to the code as
`*.test.ts(x)`, and a whole-page behaviour in `src/frontend/e2e/specs/`.

## Related pages

- [API Testing Guide](https://ui.praison.ai/docs/api/testing.md)
- [CLI Usage](https://ui.praison.ai/docs/getting-started/cli.md)
- [How to Add a Feature to PraisonAIUI](https://ui.praison.ai/docs/features/how-to-add-a-feature.md)
