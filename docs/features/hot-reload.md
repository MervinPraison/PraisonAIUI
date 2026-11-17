# Hot Reload

Two commands reload during development: `aiui serve --watch` for a docs site and
`aiui run --reload` for an app.

## Docs sites: `aiui serve --watch`

```bash
aiui serve --watch
aiui serve --config aiui.yaml --output aiui --port 8000 --watch
```

`--watch` watches the folder that holds the config file (the config, `docs/`
and anything else under it) and runs a full `aiui build` into the output
directory on every change:

```
↻ Detected changes, rebuilding...
✓ Rebuild complete
```

The browser does not refresh itself; reload the page to see the new build.

## Apps: `aiui run --reload`

```bash
aiui run app.py --reload
```

Uvicorn restarts the server when a file in the folder of `app.py` changes, and
the restarted server loads `app.py` again with the same style, datastore and
config.

## `aiui dev`

`aiui dev` is not a file watcher. It serves a small dashboard (default port
9000) that switches between the example projects in a folder (each a directory
with an `aiui.yaml`, or the old name `aiui.template.yaml`; default `examples/`):

```bash
aiui dev --examples examples --port 9000
```

## Related

- [Config Hot-Reload](config-hot-reload.md): reloading the runtime config of a
  running server
- [CLI](../getting-started/cli.md)
