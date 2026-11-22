---
nav_title: CLI tour
---

# CLI Usage

The commands you will use most. Every command and option is in the
[CLI Reference](../api/cli.md); `aiui <command> --help` prints the same from
the installed version.

## Run an app

```bash
aiui run app.py                      # a Python app with @aiui.reply / @aiui.page
aiui run chat.yaml                   # a YAML-defined agent (needs praisonaiagents)
aiui run app.py --style chat         # the classic chat instead of the app shell
aiui run app.py --port 3000 --reload # another port, restart on file changes
aiui run app.py --datastore json     # keep sessions as JSON under ~/.praisonaiui
```

Without `--style`, the style comes from `aiui.set_style()` or is detected from
the callbacks; a plain chat app opens the React app shell in its `chat`
layout. See [UI Styles](../features/styles.md).

## Build a docs site

```bash
aiui init --template docs            # writes aiui.yaml
aiui dev                             # preview on :8000; saves reload the browser
aiui validate --strict               # check the configuration
aiui docs check-links                # broken links, anchors and images
aiui build --output site --minify    # static site in ./site
aiui serve                           # build and serve the production site
```

See [Deploy to GitHub Pages](github-pages.md) to publish the build.

## Check a running server

```bash
aiui doctor                          # diagnostics; the imported aiui version and folder, PyPI's latest, stale installs
aiui health --detailed               # per-feature health (alias of health-check)
aiui test all --server http://127.0.0.1:8000
```

`aiui test` defaults to `http://127.0.0.1:8082`, so pass `--server` for a
server on another port. See [API Testing](../api/testing.md).

## Manage a running server

Management commands call the server's HTTP API. They default to
`http://127.0.0.1:8000`; pass `--server URL` for another one.

```bash
aiui sessions list
aiui sessions messages SESSION_ID
aiui memory search "dark mode"
aiui pages ids                       # page ids for aiui.set_pages()
aiui config set model gpt-4o-mini
aiui approval list --status pending
```

The full list (`sessions`, `session-ext`, `memory`, `provider`, `features`,
`pages`, `config`, `approval`, `schedule`, `skills`, `hooks`, `workflows`,
`eval`, `traces`, `surface`, `plugins`) is in the
[CLI Reference](../api/cli.md#management-commands).
