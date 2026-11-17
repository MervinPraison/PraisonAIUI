---
nav_title: CLI
---

# CLI Reference

Every `aiui` command and option. `aiui <command> --help` prints the same
information from the installed version. The wheel also installs the command
as `praisonaiui`.

For a short tour of the commands you will use most, see
[CLI Usage](../getting-started/cli.md).

## Run and build

### `aiui run`

Run the server for a Python app (`app.py`) or a YAML chat agent (`chat.yaml`).

```bash
aiui run APP_FILE [OPTIONS]
```

| Option | Default | Description |
|--------|---------|-------------|
| `APP_FILE` | required | A Python file that registers callbacks, or a `.yaml`/`.yml` chat config |
| `--port, -p` | `8000` | Port. If it is taken, the next free port (up to 10 further) is used and printed |
| `--host` | `127.0.0.1` | Address to bind to |
| `--reload, -r` | off | Restart when files change |
| `--style, -s` | detected | `app` (the React app shell), `chat` (the classic chat), `docs`, `agents`, `playground`, `dashboard` or `custom` |
| `--backend, -b` | `standalone` | `standalone`, or `praisonai` to use the PraisonAI WebSocket gateway |
| `--datastore, -d` | `sdk` | Session storage: `sdk` (shared with PraisonAI Agents), `sdk:/path`, `json`, `json:/path` or `memory`. Without the flag, a chat YAML's `datastore:` key is used |
| `--config, -c` | none | A docs-site YAML to build before serving (optional) |
| `--output, -o` | `aiui` | Folder the UI files are written to; by default next to `APP_FILE` |

Style: for a Python app `--style` wins, then `aiui.set_style()`; for a YAML
app its `style:` key wins over `--style`. Without any of them `aiui run`
detects one: `@aiui.profiles` plus
registered agents gives `agents`, `@aiui.page` gives `dashboard`, anything else
`app`. In `app`, `aiui run` opens the `chat` layout (the chat without a
canvas) unless `AIUI_LAYOUT`, `aiui.set_layout()` or YAML `layout:` picks
another. See [UI Styles](../features/styles.md) and
[Layouts](../features/layouts.md).

`aiui run` loads `~/.praisonai/.env` and then `./.env` before starting,
without overriding variables that are already set.

```bash
aiui run app.py                         # style detected; a chat app opens the app shell
aiui run app.py --style chat            # the classic chat style
aiui run app.py --port 3000 --reload
aiui run app.py --datastore json        # sessions under ~/.praisonaiui
aiui run chat.yaml                      # YAML-defined agent (needs praisonaiagents)
aiui run app.py --backend praisonai
```

### `aiui init`

Write a starter `aiui.yaml` in the current folder. It refuses to overwrite an
existing `aiui.yaml` or `aiui.template.yaml` unless `--force` is given.

| Option | Default | Description |
|--------|---------|-------------|
| `--template, -t` | `minimal` | `minimal`, `docs` or `marketing` |
| `--force, -f` | off | Overwrite existing files |
| `--frontend` | off | Also scaffold a Vite + React + shadcn frontend project |

`init` writes only the YAML file. Create the folder it points to (for the
`docs` template, `./docs` with at least one `.md` file) before `aiui build`.

### `aiui validate`

Check a docs-site configuration.

| Option | Default | Description |
|--------|---------|-------------|
| `--config, -c` | `aiui.yaml` | Configuration file ([lookup](../concepts/configuration.md#config-file-name)) |
| `--strict` | off | Unknown keys become errors |

Without `--config`, `validate`, `build` and `serve` read `./aiui.yaml`. The
old name `aiui.template.yaml` still works: when it is the only one there it is
used, with a one-line hint on stderr to rename it, and the exit code is
unchanged. When both files exist, `aiui.yaml` wins. An explicit `--config`
always wins and prints no hint. See
[Config file name](../concepts/configuration.md#config-file-name).

### `aiui build`

Build a static docs site from the configuration.

| Option | Default | Description |
|--------|---------|-------------|
| `--config, -c` | `aiui.yaml` | Configuration file ([lookup](../concepts/configuration.md#config-file-name)) |
| `--output, -o` | `aiui` | Output folder |
| `--minify` | off | Minify the JSON manifests |

The output holds `index.html`, `404.html`, the UI bundle (`assets/`,
`aiui-manifest.json`), the manifests (`ui-config.json`, `docs-nav.json`,
`route-manifest.json`), one HTML file and the Markdown source per page,
`robots.txt` and `.nojekyll`. `sitemap.xml`, `llms.txt` and `llms-full.txt`
are added when the site URL is known (`seo.siteUrl`, or a `CNAME` file next to
the configuration or in `docs/`).

### `aiui serve`

Build (unless `--no-build`) and serve a docs site.

| Option | Default | Description |
|--------|---------|-------------|
| `--config, -c` | `aiui.yaml` | Configuration file ([lookup](../concepts/configuration.md#config-file-name)) |
| `--output, -o` | `aiui` | Folder to serve |
| `--port, -p` | `8000` | Port (next free port if taken) |
| `--host` | `127.0.0.1` | Address to bind to |
| `--no-build` | off | Serve the existing output without building |
| `--watch, -w` | off | Rebuild when a file in the configuration's folder changes (reload the page yourself) |
| `--cors-origins` | empty | Comma-separated allowed origins; empty means same-origin only |
| `--ssl-certfile` | none | Certificate file for HTTPS |
| `--ssl-keyfile` | none | Private key file for HTTPS |

Paths without a file extension fall back to the single-page app. Paths that
try to leave the output folder are refused.

### `aiui dev`

A local dashboard that lists the example projects in a folder and switches
between them while they run.

| Option | Default | Description |
|--------|---------|-------------|
| `--examples, -e` | `examples` | Folder that holds the example projects |
| `--port, -p` | `9000` | Port |
| `--host` | `127.0.0.1` | Address to bind to |

## Diagnostics

| Command | Options | Description |
|---------|---------|-------------|
| `aiui doctor` | `--server, -s` (default `http://127.0.0.1:8000`), `--json` | Structured diagnostics against a running server |
| `aiui health-check` | `--server, -s`, `--detailed, -d` | Server health; `--detailed` shows each feature |
| `aiui health` | same | Alias of `health-check` |
| `aiui test <suite>` | `--server, -s` (default `http://127.0.0.1:8082`) | Integration tests against a running server: `chat`, `memory`, `sessions`, `endpoints`, `features`, `all`. See [API Testing](testing.md) |

## Plugins

```bash
aiui plugins list [--json] [--config FILE]       # installed UI plugins, version, status, load error
aiui plugins doctor [--config FILE] [--no-builtin]
```

`--config` applies the `extensions:` policy from that YAML. `doctor` checks the
entry point, the SDK version gate, `static_dir` and SRI hashes, and (unless
`--no-builtin`) page ids that a built-in page shadows. A plugin's own commands
run as `aiui <plugin> ...` or `aiui plugins <plugin> ...`;
`AIUI_DISABLE_PLUGIN_AUTOLOAD=1` turns that lookup off. See
[UI plugins](../features/plugins.md).

## Management commands

These talk to a running server over HTTP. Every one takes
`--server, -s URL` (default `http://127.0.0.1:8000`).

### `sessions`

```bash
aiui sessions list
aiui sessions create
aiui sessions get SESSION_ID
aiui sessions delete SESSION_ID
aiui sessions messages SESSION_ID
```

### `session-ext`

```bash
aiui session-ext state SESSION_ID
aiui session-ext save-state SESSION_ID --key K --value V
aiui session-ext labels SESSION_ID
aiui session-ext usage SESSION_ID
aiui session-ext compact SESSION_ID
aiui session-ext reset SESSION_ID
```

### `memory`

```bash
aiui memory list [--type short|long|entity|all]
aiui memory add TEXT [--type long]
aiui memory search QUERY [--limit 10]
aiui memory context QUERY [--limit 5]    # memory text for prompt injection
aiui memory clear [--type all]
aiui memory status
```

### `provider`

```bash
aiui provider status     # active provider and its health
aiui provider health
aiui provider agents
```

### `features` and `pages`

```bash
aiui features list       # registered feature protocols
aiui features status     # health summary
aiui pages list          # sidebar pages with group and icon
aiui pages ids           # page ids, for aiui.set_pages()
```

### `config`

Runtime configuration (stored in `config.yaml` under the data directory).

```bash
aiui config get [KEY]          # all keys when KEY is omitted
aiui config set KEY VALUE
aiui config list
aiui config history [--limit 20]
```

### `approval`

```bash
aiui approval list [--status all|pending|resolved]
aiui approval pending
aiui approval resolve APPROVAL_ID [--approved | --denied] [--reason TEXT]
```

### `schedule`

```bash
aiui schedule list
aiui schedule add NAME MESSAGE [--every 60]    # interval in seconds
aiui schedule remove JOB_ID
aiui schedule status
```

### `skills`, `hooks`, `workflows`

```bash
aiui skills list | status | discover
aiui hooks list
aiui hooks trigger HOOK_ID
aiui hooks log [--limit 20]
aiui workflows list | status | runs
aiui workflows run WORKFLOW_ID
```

### `eval` and `traces`

```bash
aiui eval status | scores | judges
aiui eval list [--limit 20] [--agent-id ID]
aiui eval run --input TEXT --output TEXT [--expected TEXT] [--agent-id cli]
aiui traces status
aiui traces list [--limit 20]
aiui traces spans [--limit 20] [--trace-id ID]
aiui traces get TRACE_ID
```

### `surface`

A2UI surfaces for the agent canvas; see [A2UI canvas](../features/a2ui-canvas.md).

```bash
aiui surface list | status
aiui surface get [SURFACE_ID] [--json]               # SURFACE_ID defaults to main
aiui surface push [SURFACE_ID] --file messages.json [--replace]
aiui surface clear [SURFACE_ID]
```

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Invalid configuration, failed request or other error |
| `2` | File or folder not found, or an unknown `--style` |
| `3` | Build failed |
| `4` | No free port near the requested one |

## Environment variables

| Variable | Effect |
|----------|--------|
| `AIUI_DATA_DIR` | Data directory (default `~/.praisonaiui`): sessions, runtime `config.yaml`, plugin state |
| `AIUI_SHELL` | `app` turns the `dashboard` style into the React app shell; `legacy` turns `app` back into `dashboard` |
| `AIUI_LAYOUT` | Default app-shell layout id; see [Layouts](../features/layouts.md) |
| `AIUI_TEMPLATES_DIR` | Serve or build with another frontend bundle folder |
| `AIUI_ALLOWED_ORIGINS` | Origins allowed for cross-site requests and WebSockets (comma-separated, or `*`) |
| `AIUI_ALLOWED_HOSTS` | Extra host names a loopback or private-address server answers |
| `AIUI_REQUIRE_TOKEN` | Require the URL token on every request |
| `AUTH_ENFORCE` | `true` gates every route and WebSocket behind auth |
| `AIUI_DISABLE_PLUGIN_AUTOLOAD` | `1` stops loading plugin CLI commands |
| `PRAISONAI_MODEL` | Default model for built-in agent features (default `gpt-4o-mini`) |
| `OPENAI_API_KEY` | Used by agent features and examples that call OpenAI |

The security variables are described in
[Deployment](../features/deployment.md).

## Python equivalent of `aiui build`

```python
from pathlib import Path

import yaml

from praisonaiui.compiler import Compiler
from praisonaiui.schema import Config

config = Config.model_validate(yaml.safe_load(Path("aiui.yaml").read_text()))
result = Compiler(config, base_path=Path(".")).compile(output_dir=Path("aiui"), minify=False)
print(result.success, result.files, result.error)
```
