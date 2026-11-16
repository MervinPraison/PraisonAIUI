# YAML Configuration

The `aiui.template.yaml` schema: what `aiui validate` checks and `aiui build`
compiles. The source of truth is
[`schema/models.py`](https://github.com/MervinPraison/PraisonAIUI/blob/main/src/praisonaiui/schema/models.py)
(`Config`). The runtime state file of a running server is a different file; see
[Runtime Persistence](#runtime-persistence-configyaml) below.

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
```

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
A route's `slots` override the template's slots for that route.

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

In addition to `aiui.template.yaml` (which drives static site generation), PraisonAIUI uses a **unified runtime config file**, `config.yaml` in the data directory (`AIUI_DATA_DIR`, default `~/.praisonaiui/`). This file stores all feature state — agents, channels, guardrails, schedules, and runtime settings — in a single YAML file that persists across server restarts.

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

### Relationship to `aiui.template.yaml`

| File | Purpose | Used By |
|------|---------|---------|
| `aiui.template.yaml` | Static site layout, components, routes | `aiui build`, `aiui serve`, `aiui validate` |
| `$AIUI_DATA_DIR/config.yaml` | Runtime feature state (agents, channels, config) | `aiui run`, dashboard API |
| `gateway.yaml` | Subset of `config.yaml` (legacy compatibility) | `praisonai gateway start` |
