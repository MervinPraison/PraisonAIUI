# Hot Reload

> Two commands reload during development: aiui dev for a docs site and

Two commands reload during development: `aiui dev` for a docs site and
`aiui run --reload` for an app.

## Docs sites: `aiui dev`

Run it in the folder that holds `aiui.yaml`:

```bash
aiui dev
```

```
⏳ Building aiui.yaml...
✓ Built in 0.4s

🚀 Preview at http://127.0.0.1:8000/
Edits rebuild and reload the page. Press Ctrl+C to stop.
```

It builds the site, serves it and opens it in the browser. Save a page, a
snippet or `aiui.yaml` and the site rebuilds and the open tab reloads by
itself, at the same scroll position (the URL keeps the `#heading`).

- **No configuration needed to start.** A folder with only a `docs/` folder of
  Markdown files works: the site is built with the defaults and titled after
  the folder.
- **A broken edit never takes the preview down.** The error is printed in the
  terminal and shown over the page, and the last good build stays up until you
  save a fix.
- **Warnings** from the build (content checks) print once each in the terminal.
- **Production output is untouched.** Each build goes to a temporary folder,
  removed on exit. The few lines of script that listen for rebuilds are added
  to pages as they are served, so `aiui build` output never contains them.
- The preview is served the way `aiui serve` serves the build: the same
  routes, cache rules and base path.

```bash
aiui dev --port 3000 --no-open       # another port; do not open a browser tab
aiui dev --config site/aiui.yaml     # a configuration elsewhere
aiui dev --base-path /               # preview at the root whatever basePath says
```

The tab listens on `/__aiui/dev` (Server-Sent Events) with a script served
from `/__aiui/dev.js`, so the preview runs under the site's
[Content Security Policy](https://ui.praison.ai/docs/features/content-security-policy.md). It only answers on this
machine unless you pass `--host`; build errors include file paths, so expose it
only on a network you trust. Every option is in the
[CLI reference](https://ui.praison.ai/docs/api/cli.md#aiui-dev).

## `aiui serve --watch`

`aiui serve --watch` rebuilds the site into the output folder on every change
in the configuration's folder, without reloading the browser. Use it when you
want the built files on disk; `aiui dev` is the writing loop.

## Apps: `aiui run --reload`

```bash
aiui run app.py --reload
```

Uvicorn restarts the server when a file in the folder of `app.py` changes, and
the restarted server loads `app.py` again with the same style, datastore and
config.

## Examples dashboard: `aiui dev --examples`

`aiui dev --examples` serves a small dashboard (default port 9000) that
switches between the example projects in a folder (each a directory with an
`aiui.yaml`, or the old name `aiui.template.yaml`):

```bash
aiui dev --examples examples --port 9000
```

## Related

- [Config Hot-Reload](https://ui.praison.ai/docs/features/config-hot-reload.md): reloading the runtime config of a
  running server
- [CLI](https://ui.praison.ai/docs/getting-started/cli.md)

## Related pages

- [Config Hot-Reload](https://ui.praison.ai/docs/features/config-hot-reload.md)
- [CLI Reference](https://ui.praison.ai/docs/api/cli.md)
- [Installation](https://ui.praison.ai/docs/getting-started/installation.md)
