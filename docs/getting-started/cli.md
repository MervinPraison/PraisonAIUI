# CLI Usage

The commands you will use most. Every command and option is in the
[CLI Reference](../api/cli.md); `aiui <command> --help` prints the same from
the installed version.

## Run an app

```bash
aiui run app.py                      # a Python app with @aiui.reply / @aiui.page
aiui run chat.yaml                   # a YAML-defined agent (needs praisonaiagents)
aiui run app.py --style app          # the opt-in React app shell
aiui run app.py --port 3000 --reload # another port, restart on file changes
aiui run app.py --datastore json     # keep sessions as JSON under ~/.praisonaiui
```

Without `--style`, the style comes from `aiui.set_style()` in the app or is
detected from its callbacks; see [UI Styles](../features/styles.md).

## Build a docs site

```bash
aiui init --template docs            # writes aiui.template.yaml
aiui validate --strict               # check the configuration
aiui build --output site --minify    # static site in ./site
aiui serve --watch                   # build, serve on :8000, rebuild on change
```

See [Deploy to GitHub Pages](github-pages.md) to publish the build.

## Check a running server

```bash
aiui doctor                          # structured diagnostics
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
