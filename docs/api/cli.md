# CLI Reference

> Every aiui command and option. aiui --help prints the same

Every `aiui` command and option. `aiui <command> --help` prints the same
information from the installed version. The wheel also installs the command
as `praisonaiui`.

For a short tour of the commands you will use most, see
[CLI Usage](https://ui.praison.ai/docs/getting-started/cli.md).

## Run and build

### `aiui run`

Run the server for a Python app (`app.py`) or a YAML chat agent (`chat.yaml`).

```bash
aiui run APP_FILE [OPTIONS]
```

| Option | Default | Description |
|--------|---------|-------------|
| `APP_FILE` | required | A Python file that registers callbacks, or a `.yaml`/`.yml` chat config |
| `--port, -p` | `8000` | Port. If it is taken, the next free port (up to 10 further) is used. The port is bound before the URL is printed and the server serves that socket, so two apps started together never get the same port |
| `--host` | `127.0.0.1` | Address to bind to |
| `--reload, -r` | off | Restart when files change |
| `--style, -s` | detected | `app` (the React app shell, default), `chat` (the classic chat), `docs`, `agents`, `playground`, `dashboard` (legacy) or `custom` |
| `--preset` | `minimal` for `app.py` | Page preset: `minimal` (Chat + your pages), `agent` (Chat, Sessions, Approvals, Usage, Memory), or `ops` (all built-in ops pages) |
| `--pages` | none | Explicit comma-separated page IDs (e.g. `chat,sessions`), `all`, or a preset name (`minimal`, `agent`, `ops`) |
| `--backend, -b` | `standalone` | `standalone`, or `praisonai` to use the PraisonAI WebSocket gateway |
| `--datastore, -d` | `sdk` | Session storage: `sdk` (shared with PraisonAI Agents), `sdk:/path`, `json`, `json:/path` or `memory`. Without the flag, a chat YAML's `datastore:` key is used |
| `--config, -c` | none | A docs-site YAML to build before serving (optional) |
| `--output, -o` | `aiui` | Folder the UI files are written to; by default next to `APP_FILE` |

Style: for a Python app `--style` wins, then `aiui.set_style()`; for a YAML
app its `style:` key wins over `--style`. Without any of them `aiui run`
detects one: `@aiui.profiles` plus registered agents gives `agents`, and
anything else (including `@aiui.reply` and `@aiui.page`) opens `app` (the React
app shell). For Python `app.py` files that do not call `aiui.set_pages()`,
`aiui run` defaults to the `minimal` preset (Chat + your own pages) unless
`--preset`, `--pages`, or `AIUI_PAGES` is set. In `app`, `aiui run` opens the
`chat` layout (the chat without a canvas) unless `AIUI_LAYOUT`,
`aiui.set_layout()` or YAML `layout:` picks another. See
[UI Styles](https://ui.praison.ai/docs/features/styles.md), [Layouts](https://ui.praison.ai/docs/features/layouts.md), and
[Build a focused app](https://ui.praison.ai/docs/guides/focused-app.md).

A chat YAML's top-level keys: `name`, `instructions`, `model`, `welcome`,
`goodbye`, `starters`, `profiles`, `tools`, `features`, `datastore`, `style`,
`theme`, `branding`, `dashboard`, `pages`, `layout` and `extensions`.
`layout:` takes a layout id (`layout: command`) or the same block as
`aiui.yaml` (`default`, `available`, `user_choice`, `primary`, `options`);
`extensions:` takes `enabled:` / `disabled:` lists, as in `aiui.yaml`. Any
other key prints a warning naming it, since it would otherwise be ignored
without a word.

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

Scaffold a starter Python Agent UI (`app.py`) or a Docs UI config (`aiui.yaml`)
in the current folder. Refuses to overwrite existing files unless `--force` is
given.

| Option | Default | Description |
|--------|---------|-------------|
| `--template, -t` | `minimal` | App templates (writes `app.py`): `agent`, `openai`, `anthropic`, `langgraph`, `crewai`, `pydantic-ai`, `praisonai`, `dashboard`. Docs templates (writes `aiui.yaml`): `minimal`, `docs`, `marketing` |
| `--force, -f` | off | Overwrite existing files |
| `--frontend` | off | Also scaffold a Vite + React + shadcn frontend project |

```bash
aiui init --template agent        # runnable starter app.py with starters + send_block
aiui init --template openai       # OpenAI streaming chat app.py
aiui init --template langgraph    # LangGraph agent app.py
aiui init --template dashboard    # split-pane workspace (chat_panel) + File Inspector (aiui.interface)
aiui init --template docs         # docs-site aiui.yaml
```

For docs templates, the file's first line (`# yaml-language-server: $schema=https://ui.praison.ai/aiui.schema.json`)
gives autocomplete and hover docs in editors ([Editor setup](https://ui.praison.ai/docs/concepts/configuration.md#editor-setup)).
Create the folder it points to (for the `docs` template, `./docs` with at least
one `.md` file) before `aiui build`.

### `aiui validate`

Check a docs-site configuration and its pages.

| Option | Default | Description |
|--------|---------|-------------|
| `--config, -c` | `aiui.yaml` | Configuration file ([lookup](https://ui.praison.ai/docs/concepts/configuration.md#config-file-name)) |
| `--strict` | off | Unknown keys, broken links, nav entries without a page and content issues (7xxx) become errors (exit 1) |
| `--format` | `text` | `json` prints `{valid, errors, warnings}`, each with `code`, `file`, `line`, `message`, `suggestion` |

Each finding prints as `[category] code file:line: message` with a fix hint
under it:

```text
  [content] 7005 docs/guide/setup.md:14: heading jumps from h2 to h4
    💡 Use ### here; screen readers navigate by heading level
```

| Code | Finding |
|------|---------|
| 1003 | unknown key (ignored); in a `$ref` file the file is named |
| 1004 | key accepted but has no effect; unknown component tag in a page |
| 2101 | a nav entry names no docs page |
| 2102 | a navigation tab, menu item, anchor or dropdown with no pages, groups or `href` |
| 5001, 51xx, 5201 | theme, layout and search settings that are ignored |
| 6001, 6002 | broken link or missing image (`aiui docs check-links`); OpenAPI spec problems |
| 7000 | page front matter is not valid YAML (the page loses its title) |
| 7001 | front matter key has the wrong type ([keys](https://ui.praison.ai/docs/features/writing-docs.md#front-matter)) |
| 7002 | image without alt text (`![](x.png)`, `<img>` with no `alt`; `alt=""` marks a decorative image) |
| 7003 | two files publish the same page URL (`intro.md` and `01-intro.md`) |
| 7004 | two sidebar entries in one folder have the same title |
| 7005 | heading skips a level (`##` then `####`) |
| 7006 | page has nothing beyond its headings |
| 7007 | `{{name}}` with no value under `variables:` ([variables](https://ui.praison.ai/docs/features/writing-docs.md#reusable-snippets-and-variables)) |
| 7008 | snippet not found, outside the project folder, or including itself (fails `aiui build`) |
| 7009 | `icon` (front matter, navigation, a component's `icon="…"`) that is not a [lucide](https://lucide.dev/icons) name, an emoji or an image URL, with the nearest name |
| 7010 | a redirect loops, or ends at a docs path with no page ([redirects](https://ui.praison.ai/docs/features/redirects.md#checks)) |
| 7011 | a page is published at a redirect's source, so the redirect never runs |
| 7012 | front matter `openapi:` / `api:` or a navigation `METHOD /path` entry that names no operation in the loaded specs ([OpenAPI](https://ui.praison.ai/docs/features/openapi.md#endpoints-on-your-own-pages)) |
| 7013 | front matter `related` names a page that does not exist ([related pages](https://ui.praison.ai/docs/features/writing-docs.md#related-pages)) |
| 7014 | a `site.customCss`, `site.customJs`, `site.theme.fonts` or `site.theme.codeLanguages` file that is not in the project folder ([fonts and custom files](https://ui.praison.ai/docs/features/theming.md#fonts)) |
| 7015 | `site.theme.code` names a theme that is not bundled (with the nearest name), or a `site.theme.codeLanguages` file is not a TextMate grammar ([code blocks](https://ui.praison.ai/docs/features/theming.md#code-blocks)) |
| 7016 | a `::: module` block names no module or member, or has an unknown option (fails `aiui build`; [Python API reference](https://ui.praison.ai/docs/features/api-reference-python.md#checks)) |
| 7017 | `content.docs.auth` is set, and only `aiui serve` / `aiui dev` enforce it (`aiui build`); front matter `public` / `groups` without `content.docs.auth`, or a group no reader is in ([docs sign-in](https://ui.praison.ai/docs/features/docs-auth.md)) |
| 7018 | two `navigation.versions` with the same name, more than one marked `default: true`, or a version that lists a page of another version's folder ([versions](https://ui.praison.ai/docs/features/navigation.md#versions)) |
| 7019 | raw HTML a page shows differently than written: an `<iframe>` that is not a YouTube, Vimeo or Loom video (shown as a link; the host is named), or `<script>`, `<style>`, `<link>`, `<form>`, `<audio>`, `<object>`, `<embed>` (removed). Also an `aiui build` warning ([raw HTML](https://ui.praison.ai/docs/features/writing-docs.md#raw-html)) |
| 7020 | two `navigation.languages` with the same code, more than one marked `default: true`, or a version folder inside a language folder (`docs/fr/v1/`; [languages](https://ui.praison.ai/docs/features/navigation.md#languages)) |
| 7021 | `site.components` is not a `.js` / `.mjs` file in the project folder, or the build finds no component tag in it ([your own components](https://ui.praison.ai/docs/features/writing-docs.md#your-own-components)) |
| 7022 | a class on a component tag or raw HTML that docs pages drop (not a docs utility class; the nearest allowed one is suggested), or a `style` attribute (always removed). Also an `aiui build` warning ([styling with classes](https://ui.praison.ai/docs/features/writing-docs.md#styling-with-classes)) |
| 7101 | `site.theme.accent` under WCAG AA 3:1 contrast on the light or dark background, with a shade that passes |
| 7102 | `logo`, `favicon` or `site.theme.background` image that is not a file in the project folder ([branding](https://ui.praison.ai/docs/features/theming.md#branding-a-docs-site)) |

Without `--config`, `validate`, `build` and `serve` read `./aiui.yaml`. The
old name `aiui.template.yaml` still works: when it is the only one there it is
used, with a one-line hint on stderr to rename it, and the exit code is
unchanged. When both files exist, `aiui.yaml` wins. An explicit `--config`
always wins and prints no hint. See
[Config file name](https://ui.praison.ai/docs/concepts/configuration.md#config-file-name).

### `aiui schema`

Print the JSON Schema of `aiui.yaml`, generated from the `Config` model of the
installed version; `--output, -o <file>` writes it to a file. The schema is
also published at `https://ui.praison.ai/aiui.schema.json`; see
[Editor setup](https://ui.praison.ai/docs/concepts/configuration.md#editor-setup).

### `aiui build`

Build a static docs site from the configuration.

| Option | Default | Description |
|--------|---------|-------------|
| `--config, -c` | `aiui.yaml` | Configuration file ([lookup](https://ui.praison.ai/docs/concepts/configuration.md#config-file-name)) |
| `--output, -o` | `aiui` | Output folder |
| `--minify` | off | Minify the JSON manifests |
| `--strict` | off | Stop with exit code 1 on a broken link (without it, broken links are warnings) |

The output holds `index.html`, `404.html`, the UI bundle (`assets/`,
`aiui-manifest.json`), the manifests (`ui-config.json`, `docs-nav.json`,
`route-manifest.json`), one HTML file and the Markdown source per page,
`robots.txt` and `.nojekyll`. `sitemap.xml`, `llms.txt` and `llms-full.txt`
are added when the site URL is known (`seo.siteUrl`, or a `CNAME` file next to
the configuration or in `docs/`).

### `aiui docs check-links`

Find broken page links, `#anchor`s, images, component `href`s and nav entries
before you deploy. Prints `file:line: target: reason (did you mean X?)` and
exits `1` when a link is broken. See
[Writing docs pages → Check links](https://ui.praison.ai/docs/features/writing-docs.md#check-links).

| Option | Default | Description |
|--------|---------|-------------|
| `--config, -c` | `aiui.yaml` | Configuration file |
| `--external` | off | Also request every `http(s)` URL (HEAD, then GET; 16 at a time) |
| `--timeout` | `10` | Seconds to wait for each external URL |
| `--json` | off | Print `{"checked", "pages", "broken": [{file, line, target, reason, suggestion}]}` |

### `aiui serve`

Build (unless `--no-build`) and serve a docs site.

| Option | Default | Description |
|--------|---------|-------------|
| `--config, -c` | `aiui.yaml` | Configuration file ([lookup](https://ui.praison.ai/docs/concepts/configuration.md#config-file-name)) |
| `--output, -o` | `aiui` | Folder to serve |
| `--port, -p` | `8000` | Port (next free port if taken) |
| `--host` | `127.0.0.1` | Address to bind to |
| `--no-build` | off | Serve the existing output without building |
| `--watch, -w` | off | Rebuild when a file in the configuration's folder changes (reload the page yourself; `aiui dev` reloads it for you) |
| `--cors-origins` | empty | Comma-separated allowed origins; empty means same-origin only |
| `--ssl-certfile` | none | Certificate file for HTTPS |
| `--ssl-keyfile` | none | Private key file for HTTPS |
| `--open / --no-open` | auto | Open the site in a browser. Auto opens it only when run from a terminal; never in CI, under a test runner or from a script ([when a browser opens](#when-a-browser-opens)) |

Paths without a file extension fall back to the single-page app. Paths that
try to leave the output folder are refused. Every response carries the `/*`
headers of the build's `_headers` file, which holds the site's
[Content Security Policy](https://ui.praison.ai/docs/features/content-security-policy.md).

#### When a browser opens

`aiui serve`, `aiui dev` and `aiui dev --examples` open a browser tab only for a
person at a terminal. With neither flag, the tab opens when standard output is a
terminal and no CI or test runner is detected (`CI`, `GITHUB_ACTIONS`,
`GITLAB_CI`, `BUILDKITE`, `PYTEST_CURRENT_TEST`). `--open` forces it,
`--no-open` skips it, and `AIUI_NO_BROWSER=1` turns it off everywhere, for
scripts and coding agents that start these servers.

### `aiui dev`

Preview the docs site while you write it: build, serve, and reload the open
browser tab on every save. A failed build is shown in the terminal and over
the page while the last good build stays up. Run it in the folder that holds
`aiui.yaml`, or in a folder with only a `docs/` folder. See
[Hot Reload](https://ui.praison.ai/docs/features/hot-reload.md).

| Option | Default | Description |
|--------|---------|-------------|
| `--config, -c` | `aiui.yaml` | Configuration file ([lookup](https://ui.praison.ai/docs/concepts/configuration.md#config-file-name)) |
| `--port, -p` | `8000` | Port (next free port if taken) |
| `--host` | `127.0.0.1` | Address to bind to |
| `--open / --no-open` | auto | Open the preview in a browser; auto as for `aiui serve` ([when a browser opens](#when-a-browser-opens)) |
| `--base-path` | as `aiui build` | URL path to preview the site under |
| `--examples, -e` | none | Run the examples dashboard for this folder instead (default port `9000`) |

`aiui dev --examples examples` is the older dashboard that lists the example
projects in a folder and switches between them. In a folder with no
configuration and no `docs/` but an `examples/` folder, plain `aiui dev` still
opens it.

## Diagnostics

| Command | Options | Description |
|---------|---------|-------------|
| `aiui doctor` | `--server, -s` (default `http://127.0.0.1:8000`), `--json` | Structured diagnostics against a running server. The first two checks need no server: `aiui Version` (the imported version against PyPI's latest) and `aiui Install` (the version and folder actually imported; warns when pip's metadata names another version, as a stale editable install does, and prints the reinstall command) |
| `aiui health-check` | `--server, -s`, `--detailed, -d` | Server health; `--detailed` shows each feature |
| `aiui health` | same | Alias of `health-check` |
| `aiui test <suite>` | `--server, -s` (default `http://127.0.0.1:8082`) | Integration tests against a running server: `chat`, `memory`, `sessions`, `endpoints`, `features`, `all`. See [API Testing](https://ui.praison.ai/docs/api/testing.md) |

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
[UI plugins](https://ui.praison.ai/docs/features/plugins.md).

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

A2UI surfaces for the agent canvas; see [A2UI Overview](https://ui.praison.ai/docs/a2ui/overview.md).

```bash
aiui surface list | status
aiui surface capabilities [--json]
aiui surface get [SURFACE_ID] [--json]               # SURFACE_ID defaults to main
aiui surface push [SURFACE_ID] --file surface.jsonl [--replace]
aiui surface action [SURFACE_ID] ACTION [--component ID] [--data '{}']
aiui surface clear [SURFACE_ID]
```

### `notifications`

Manage in-app notifications (`NotificationStoreProtocol`, REST + SSE); see [Notifications](https://ui.praison.ai/docs/features/notifications.md).

```bash
aiui notifications list [--unread] [--category NAME] [--json]
aiui notifications push TITLE [--type info|success|warning|error] [--description TEXT] [--category NAME] [--pinned] [--dedupe-key KEY]
aiui notifications read ID
aiui notifications read-all
aiui notifications remove ID
aiui notifications clear [--include-pinned] [--read-only]
```

### `telemetry`

Inspect live HTTP latency, throughput, memory, and recorded metrics.

```bash
aiui telemetry perf [--json]
aiui telemetry status
aiui telemetry metrics [--json]
```

### `auth`

`aiui auth create-secret` prints a new session secret (offline; see
[Sessions](https://ui.praison.ai/docs/features/deployment.md#sessions)); `aiui auth create-key --name my-app` creates an
API key on the running server and prints it once.

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
| `AIUI_LAYOUT` | Default app-shell layout id; see [Layouts](https://ui.praison.ai/docs/features/layouts.md) |
| `AIUI_TEMPLATES_DIR` | Serve or build with another frontend bundle folder |
| `AIUI_ALLOWED_ORIGINS` | Origins allowed for cross-site requests and WebSockets (comma-separated, or `*`) |
| `AIUI_ALLOWED_HOSTS` | Extra host names a loopback or private-address server answers |
| `AIUI_REQUIRE_TOKEN` | Require the URL token on every request |
| `AUTH_ENFORCE` | `true` gates every route and WebSocket behind auth |
| `AIUI_AUTH_SECRET` | Session signing secret (comma-separated to rotate: first signs, all verify); default a generated `<data dir>/auth_secret` |
| `AIUI_SESSION_LIFETIME` | How long a sign-in lasts while unused (`14d` default, `12h`, `3600`); overrides YAML `auth.sessionLifetime` |
| `AIUI_DISABLE_PLUGIN_AUTOLOAD` | `1` stops loading plugin CLI commands |
| `PRAISONAI_MODEL` | Default model for built-in agent features (default `gpt-4o-mini`) |
| `OPENAI_API_KEY` | Used by agent features and examples that call OpenAI |

The security variables are described in
[Deployment](https://ui.praison.ai/docs/features/deployment.md).

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

## Related pages

- [Hot Reload](https://ui.praison.ai/docs/features/hot-reload.md)
- [Features REST API Reference](https://ui.praison.ai/docs/api/features-api.md)
- [Guardrails, Evals, Traces, Usage & Logs](https://ui.praison.ai/docs/features/observability-and-guardrails.md)
