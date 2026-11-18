---
nav_title: YAML configuration
---

# YAML Configuration

The `aiui.yaml` schema: what `aiui validate` checks and `aiui build`
compiles. The source of truth is
[`schema/models.py`](https://github.com/MervinPraison/PraisonAIUI/blob/main/src/praisonaiui/schema/models.py)
(`Config`). The runtime state file of a running server is a different file; see
[Runtime Persistence](#runtime-persistence-configyaml) below.

## Config file name

`aiui validate`, `aiui build` and `aiui serve` find the file in this order:

1. `--config <path>`, when given. It always wins and prints nothing extra.
2. `./aiui.yaml`.
3. `./aiui.template.yaml`, the old name. It still works; the command prints one
   dim line on stderr and its exit code does not change:
   `Using aiui.template.yaml; rename it to aiui.yaml (the old name keeps working).`

When both files exist, `aiui.yaml` is used and the command says so in one line
(`Using aiui.yaml; aiui.template.yaml is also here and is ignored.`). With
neither, the command stops with `Configuration file not found: aiui.yaml`.
`aiui init` writes `aiui.yaml` and refuses to overwrite either name without
`--force`. `aiui dev` reads either name, and `aiui dev --examples` accepts either name in each example folder. `aiui.yml`
is not looked up; pass it with `--config`.

## Split the config with `$ref`

Any mapping can live in its own file. `$ref` names a YAML (or JSON) file,
relative to the file that holds the `$ref`:

```yaml
# aiui.yaml
site:
  title: My Docs
navigation:
  $ref: ./config/nav.yaml
```

```yaml
# config/nav.yaml
tabs:
  - tab: Guides
    groups:
      - $ref: ./groups/guides.yaml
```

- Included files can include others; keys written next to `$ref` override the
  included ones.
- Paths stay inside the folder of `aiui.yaml`; a file that includes itself,
  directly or through others, is an error (`$ref cycle: aiui.yaml ->
  config/nav.yaml -> aiui.yaml`).
- Errors name the file and line of the `$ref` (`aiui.yaml:6: $ref
  './config/nav.yaml' not found`); a YAML error or an unknown key inside an
  included file names that file. `validate`, `build`, `serve`, `docs
  check-links` and the server all read includes.

## Editor setup

`aiui init` starts `aiui.yaml` with this line:

```yaml
# yaml-language-server: $schema=https://ui.praison.ai/aiui.schema.json
```

Editors that run the YAML language server (VS Code with the Red Hat YAML
extension, JetBrains IDEs, Neovim, Zed) then complete keys, show each key's
description on hover and underline wrong values as you type; add the line to
an existing `aiui.yaml` for the same. The schema is generated from the
`Config` model, so it never drifts from `aiui validate`. For the exact
installed version (offline, or pinned), run `aiui schema -o aiui.schema.json`
and use `$schema=./aiui.schema.json`.

## Overview

| Key | What it sets | Page |
|-----|--------------|------|
| `schemaVersion` | Schema version (`1`) | below |
| `site` | Title, description, theme, logo, custom CSS | below, [Theming](../features/theming.md) |
| `style` | UI style (`docs` by default for a site) | [UI Styles](../features/styles.md) |
| `content` | Where the Markdown lives | [Content Sources](../features/content-sources.md) |
| `components`, `templates`, `routes` | Layout of each page | below, [Templates](templates.md), [Slots](slots.md) |
| `navigation`, `navbar`, `footer`, `logo`, `search` | Docs site chrome | [Navigation](../features/navigation.md) |
| `seo`, `i18n`, `a11y` | Meta tags, locales, accessibility switches | [SEO](../features/seo.md), [i18n](../features/i18n.md) |
| `layout` | Chat position, and the app shell's layouts | [Layouts](../features/layouts.md) |
| `chat`, `auth`, `dashboard`, `widgets`, `extensions` | Chat, sign-in, dashboard and plugin settings | [Deployment](../features/deployment.md), [Plugins](../features/plugins.md) |
| `dependencies` | shadcn components to install at build time | below |

`aiui validate --strict` turns unknown keys into errors.

## Schema Version

Always specify the schema version:

```yaml
schemaVersion: 1
```

## Site Configuration

```yaml
site:
  title: "My Documentation"          # Required
  description: "Site description"    # Optional
  routeBaseDocs: "/docs"             # Default: /docs
  ui: "shadcn"                       # Theming hint (shadcn | mui | chakra)
  theme:
    preset: "zinc"                   # Any Tailwind color (22 options)
    radius: "md"                     # none | sm | md | lg | xl
    darkMode: true
```

> **Note**: The `ui` field is a theming hint. Components are UI-agnostic and use CSS classes you can style with any framework.

## Component Dependencies

Auto-install shadcn components at build time:

```yaml
dependencies:
  shadcn:
    - accordion
    - tabs
    - dialog
```

When you run `aiui build`, missing components are installed with
`npx shadcn@latest add <name>` into the frontend source (`src/frontend` in a
repository checkout). This only matters when you build the frontend yourself;
the bundled React app does not change.

## Content Sources

```yaml
content:
  docs:
    dir: "./docs"                    # Path to docs folder
    include:                         # Glob patterns
      - "**/*.md"
      - "**/*.mdx"
    exclude:                         # Excluded patterns
      - "**/drafts/**"
    editLink:                        # "Edit this page" under each page
      pattern: "https://github.com/acme/site/edit/main/docs/:path"
      text: "Edit this page"         # optional
    lastUpdated: true                # the date of the page's last commit
    feedback:                        # "Was this page helpful?"
      issues: "https://github.com/acme/site/issues/new"
    mcp: false                       # no MCP server on aiui serve (default: on)
```

`editLink`, `lastUpdated` and `feedback` draw the page footer; see
[Writing docs pages → Page footer](../features/writing-docs.md#page-footer).
`mcp` is the [docs MCP server](../features/ai-ready-docs.md#mcp-server).

`indexFiles` and `nav` (`mode`, `sort`, `collapsible`, `maxDepth`) are accepted
but not read by the build yet; see [Navigation](../features/navigation.md).

## Components

Define reusable components:

```yaml
components:
  my_header:
    type: "Header"
    props:
      logoText: "My Site"
      cta:
        label: "Get Started"
        href: "/docs"

  my_footer:
    type: "Footer"
    props:
      text: "© 2024"
```

### Built-in Component Types

| Type | Description |
|------|-------------|
| `Header` | Site header with logo, nav, CTA |
| `Footer` | Site footer |
| `DocsSidebar` | Documentation sidebar navigation |
| `Toc` | Table of contents |
| `DocContent` | Rendered markdown content |

## Templates

Templates combine a layout with slot assignments:

```yaml
templates:
  docs:
    layout: "ThreeColumnLayout"
    slots:
      header: { ref: "my_header" }     # Reference a component
      left: { ref: "sidebar_docs" }
      main: { type: "DocContent" }     # Direct type assignment
      right: { type: "Toc" }
      footer: { ref: "my_footer" }
```

### Layouts

| Layout | Description |
|--------|-------------|
| `ThreeColumnLayout` | Sidebar + Content + TOC |
| `TwoColumnLayout` | Sidebar + Content |
| `CenteredLayout` | Centered content, no sidebar |
| `FullWidthLayout` | Full width content |
| `FlexibleLayout` | WordPress-style widget zones |

## Widget Zones

Place widgets in layout zones without modifying markdown:

```yaml
templates:
  docs:
    layout: "FlexibleLayout"
    zones:
      rightSidebar:
        - type: "StatsCard"
          props:
            title: "Users"
            value: "15,231"
            change: "+20%"
      footer:
        - type: "Newsletter"
        - type: "Copyright"
          props:
            text: "© 2024"
```

Zones, the widgets and which layouts render them:
[Widget Zones](../features/widget-zones.md).

## Routes

Map URL patterns to templates:

```yaml
routes:
  - match: "/docs/changelog"
    template: "docs"
    slots:
      right: null                      # Override: hide TOC

  - match: "/docs/**"
    template: "docs"
```

Route matching uses glob patterns:
- `*` - one path segment
- `**` - any number of segments

The first matching route wins, so list specific routes before broad ones.
A route's `slots` can override only the `right` slot in the docs site
(`right: null` hides the table of contents); header and footer are read from
the template, so per-route overrides of them have no effect.

## Complete Example

```yaml
schemaVersion: 1

site:
  title: "PraisonAI Docs"
  ui: "shadcn"
  theme:
    darkMode: true

content:
  docs:
    dir: "./docs"

components:
  header:
    type: "Header"
    props:
      logoText: "PraisonAI"

  footer:
    type: "Footer"
    props:
      text: "© 2024 Praison Limited"

  sidebar:
    type: "DocsSidebar"
    props:
      source: "docs-nav"

templates:
  docs:
    layout: "ThreeColumnLayout"
    slots:
      header: { ref: "header" }
      left: { ref: "sidebar" }
      main: { type: "DocContent" }
      right: { type: "Toc" }
      footer: { ref: "footer" }

routes:
  - match: "/docs/**"
    template: "docs"
```

---

## Runtime Persistence (`config.yaml`)

> **Single source of truth** for all runtime feature state.

In addition to `aiui.yaml` (which drives static site generation), PraisonAIUI uses a **unified runtime config file**, `config.yaml` in the data directory (`AIUI_DATA_DIR`, default `~/.praisonaiui/`). This file stores all feature state — agents, channels, guardrails, schedules, and runtime settings — in a single YAML file that persists across server restarts.

This is compatible with the `gateway.yaml` schema used by `praisonai gateway start --config`.

### Schema

```yaml
# ~/.praisonaiui/config.yaml (auto-generated)
schemaVersion: 2

server:
  host: "127.0.0.1"
  port: 8003

provider:
  name: "openai"
  model: "gpt-4o-mini"

gateway:
  host: "127.0.0.1"
  port: 8765

# Agent definitions (same schema as gateway.yaml)
agents:
  personal:
    name: "Personal Assistant"
    instructions: "You are a friendly personal assistant."
    model: "gpt-4o-mini"
    tools: ["internet_search"]

# Messaging channels
channels:
  telegram_bot:
    name: "My Bot"
    platform: "telegram"
    config:
      bot_token: "env:TELEGRAM_BOT_TOKEN"

# Runtime configuration (set via /api/config/runtime)
runtime_config:
  model: "gpt-4o"
  temperature: 0.7

# Guardrail definitions
guardrails:
  registry:
    polite_check:
      description: "Output must be polite"

# Scheduled jobs
schedules:
  jobs:
    daily_report:
      name: "Daily Report"
      schedule:
        kind: every
        every_seconds: 86400
```

### How It Works

All CRUD operations (dashboard, REST API, CLI) **automatically write back** to this file:

| Feature | Section | Written On |
|---------|---------|------------|
| Config Runtime | `runtime_config` | PATCH, PUT, DELETE, apply |
| Guardrails | `guardrails` | Register |
| Channels | `channels` | Add, update, delete |
| Schedules | `schedules` | Add, remove, update |
| Agents | `agents` | Create, update, delete |

- **Atomic writes**: a temp file and `os.replace()` prevent corruption.
- **Hot reload**: the [Config Hot-Reload](../features/config-hot-reload.md) watcher, once started, reloads this file after external edits.
- **Secrets**: channel secrets are written as `env:VAR_NAME` references (a `<key>_ref` key works too); the server refuses an inline token that looks like a secret and redacts secrets in API responses.

Rule of thumb: secrets (API keys, tokens) go in environment variables;
preferences (model, theme, branding) in the config file.

### Relationship to `aiui.yaml`

| File | Purpose | Used By |
|------|---------|---------|
| `aiui.yaml` | Static site layout, components, routes | `aiui build`, `aiui serve`, `aiui validate` |
| `$AIUI_DATA_DIR/config.yaml` | Runtime feature state (agents, channels, config) | `aiui run`, dashboard API |
| `gateway.yaml` | Subset of `config.yaml` (legacy compatibility) | `praisonai gateway start` |
