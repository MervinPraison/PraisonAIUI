# CLI Usage

> The commands you will use most. Every command and option is in the

The commands you will use most. Every command and option is in the
[CLI Reference](https://ui.praison.ai/docs/api/cli.md); `aiui <command> --help` prints the same from
the installed version.

## Scaffold and run an app

```bash
aiui init --template agent           # starter app.py (also: openai, anthropic, langgraph, crewai, pydantic-ai, praisonai, dashboard)
aiui run app.py                      # opens in focused mode (Chat + your own pages)
aiui run app.py --preset agent       # adds Sessions, Approvals, Usage, and Memory
aiui run app.py --preset ops         # enables the full built-in control plane
aiui run chat.yaml                   # a YAML-defined agent (needs praisonaiagents)
aiui run app.py --style chat         # the classic chat instead of the app shell
aiui run app.py --port 3000 --reload # another port, restart on file changes
aiui run app.py --datastore json     # keep sessions as JSON under ~/.praisonaiui
```

Without `--style`, the style comes from `aiui.set_style()` or is detected from
the callbacks; Python apps with `@aiui.reply` or `@aiui.page` open the React app
shell (`style: app`) in focused mode. See [UI Styles](https://ui.praison.ai/docs/features/styles.md) and
[Build a focused app](https://ui.praison.ai/docs/guides/focused-app.md).

## Build a docs site

```bash
aiui init --template docs            # writes aiui.yaml
aiui dev                             # preview on :8000; saves reload the browser
aiui validate --strict               # check the configuration
aiui docs check-links                # broken links, anchors and images
aiui build --output site --minify    # static site in ./site
aiui serve                           # build and serve the production site
```

See [Deploy to GitHub Pages](https://ui.praison.ai/docs/getting-started/github-pages.md) to publish the build.

## Check a running server

```bash
aiui doctor                          # diagnostics; the imported aiui version and folder, PyPI's latest, stale installs
aiui health --detailed               # per-feature health (alias of health-check)
aiui test all --server http://127.0.0.1:8000
```

`aiui test` defaults to `http://127.0.0.1:8082`, so pass `--server` for a
server on another port. See [API Testing](https://ui.praison.ai/docs/api/testing.md).

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
[CLI Reference](https://ui.praison.ai/docs/api/cli.md#management-commands).

## Related pages

- [Health API Reference](https://ui.praison.ai/docs/api/health.md)
- [Migrating from Decorator Chat Apps](https://ui.praison.ai/docs/guides/from-chat-apps.md)
- [Hot Reload](https://ui.praison.ai/docs/features/hot-reload.md)
