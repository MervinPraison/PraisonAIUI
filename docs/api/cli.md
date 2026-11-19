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

Write a starter `aiui.yaml` in the current folder. It refuses to overwrite an
existing `aiui.yaml` or `aiui.template.yaml` unless `--force` is given.

| Option | Default | Description |
|--------|---------|-------------|
| `--template, -t` | `minimal` | `minimal`, `docs` or `marketing` |
| `--force, -f` | off | Overwrite existing files |
| `--frontend` | off | Also scaffold a Vite + React + shadcn frontend project |

The file's first line, `# yaml-language-server: $schema=https://ui.praison.ai/aiui.schema.json`,
gives autocomplete and hover docs in editors ([Editor setup](../concepts/configuration.md#editor-setup)).
`init` writes only the YAML file. Create the folder it points to (for the
`docs` template, `./docs` with at least one `.md` file) before `aiui build`.

### `aiui validate`

Check a docs-site configuration and its pages.

| Option | Default | Description |
|--------|---------|-------------|
| `--config, -c` | `aiui.yaml` | Configuration file ([lookup](../concepts/configuration.md#config-file-name)) |
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
| 7001 | front matter key has the wrong type ([keys](../features/writing-docs.md#front-matter)) |
| 7002 | image without alt text (`![](x.png)`, `<img>` with no `alt`; `alt=""` marks a decorative image) |
| 7003 | two files publish the same page URL (`intro.md` and `01-intro.md`) |
| 7004 | two sidebar entries in one folder have the same title |
| 7005 | heading skips a level (`##` then `####`) |
| 7006 | page has nothing beyond its headings |
| 7007 | `{{name}}` with no value under `variables:` ([variables](../features/writing-docs.md#reusable-snippets-and-variables)) |
| 7008 | snippet not found, outside the project folder, or including itself (fails `aiui build`) |
| 7009 | `icon` (front matter, navigation, a component's `icon="…"`) that is not a [lucide](https://lucide.dev/icons) name, an emoji or an image URL, with the nearest name |
| 7010 | a redirect loops, or ends at a docs path with no page ([redirects](../features/redirects.md#checks)) |
| 7011 | a page is published at a redirect's source, so the redirect never runs |
| 7012 | front matter `openapi:` / `api:` or a navigation `METHOD /path` entry that names no operation in the loaded specs ([OpenAPI](../features/openapi.md#endpoints-on-your-own-pages)) |
| 7013 | front matter `related` names a page that does not exist ([related pages](../features/writing-docs.md#related-pages)) |
| 7014 | a `site.customCss`, `site.customJs`, `site.theme.fonts` or `site.theme.codeLanguages` file that is not in the project folder ([fonts and custom files](../features/theming.md#fonts)) |
| 7015 | `site.theme.code` names a theme that is not bundled (with the nearest name), or a `site.theme.codeLanguages` file is not a TextMate grammar ([code blocks](../features/theming.md#code-blocks)) |
| 7016 | a `::: module` block names no module or member, or has an unknown option (fails `aiui build`; [Python API reference](../features/api-reference-python.md#checks)) |
| 7017 | `content.docs.auth` is set, and only `aiui serve` / `aiui dev` enforce it (`aiui build`); front matter `public` / `groups` without `content.docs.auth`, or a group no reader is in ([docs sign-in](../features/docs-auth.md)) |
| 7018 | two `navigation.versions` with the same name, more than one marked `default: true`, or a version that lists a page of another version's folder ([versions](../features/navigation.md#versions)) |
| 7101 | `site.theme.accent` under WCAG AA 3:1 contrast on the light or dark background, with a shade that passes |
| 7102 | `logo`, `favicon` or `site.theme.background` image that is not a file in the project folder ([branding](../features/theming.md#branding-a-docs-site)) |

Without `--config`, `validate`, `build` and `serve` read `./aiui.yaml`. The
old name `aiui.template.yaml` still works: when it is the only one there it is
used, with a one-line hint on stderr to rename it, and the exit code is
unchanged. When both files exist, `aiui.yaml` wins. An explicit `--config`
always wins and prints no hint. See
[Config file name](../concepts/configuration.md#config-file-name).

### `aiui schema`

Print the JSON Schema of `aiui.yaml`, generated from the `Config` model of the
installed version; `--output, -o <file>` writes it to a file. The schema is
also published at `https://ui.praison.ai/aiui.schema.json`; see
[Editor setup](../concepts/configuration.md#editor-setup).

### `aiui build`

Build a static docs site from the configuration.

| Option | Default | Description |
|--------|---------|-------------|
| `--config, -c` | `aiui.yaml` | Configuration file ([lookup](../concepts/configuration.md#config-file-name)) |
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
[Writing docs pages → Check links](../features/writing-docs.md#check-links).

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
| `--config, -c` | `aiui.yaml` | Configuration file ([lookup](../concepts/configuration.md#config-file-name)) |
| `--output, -o` | `aiui` | Folder to serve |
| `--port, -p` | `8000` | Port (next free port if taken) |
| `--host` | `127.0.0.1` | Address to bind to |
| `--no-build` | off | Serve the existing output without building |
| `--watch, -w` | off | Rebuild when a file in the configuration's folder changes (reload the page yourself; `aiui dev` reloads it for you) |
| `--cors-origins` | empty | Comma-separated allowed origins; empty means same-origin only |
| `--ssl-certfile` | none | Certificate file for HTTPS |
| `--ssl-keyfile` | none | Private key file for HTTPS |

Paths without a file extension fall back to the single-page app. Paths that
try to leave the output folder are refused. Every response carries the `/*`
headers of the build's `_headers` file, which holds the site's
[Content Security Policy](../features/content-security-policy.md).

### `aiui dev`

Preview the docs site while you write it: build, serve, and reload the open
browser tab on every save. A failed build is shown in the terminal and over
the page while the last good build stays up. Run it in the folder that holds
`aiui.yaml`, or in a folder with only a `docs/` folder. See
[Hot Reload](../features/hot-reload.md).

| Option | Default | Description |
|--------|---------|-------------|
| `--config, -c` | `aiui.yaml` | Configuration file ([lookup](../concepts/configuration.md#config-file-name)) |
| `--port, -p` | `8000` | Port (next free port if taken) |
| `--host` | `127.0.0.1` | Address to bind to |
| `--open / --no-open` | `--open` | Open the preview in the browser |
| `--base-path` | as `aiui build` | URL path to preview the site under |
| `--examples, -e` | none | Run the examples dashboard for this folder instead (default port `9000`) |

`aiui dev --examples examples` is the older dashboard that lists the example
projects in a folder and switches between them. In a folder with no
configuration and no `docs/` but an `examples/` folder, plain `aiui dev` still
opens it.

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
