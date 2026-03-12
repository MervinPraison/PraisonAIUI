# YAML Configuration

Complete guide to the `aiui.template.yaml` configuration schema.

## Overview

PraisonAIUI uses a single YAML file to configure your entire site. This file defines:

- **Site metadata** - Title, description, theme
- **Content sources** - Where to find your docs
- **Components** - Reusable UI elements
- **Templates** - Page layouts with slots
- **Routes** - URL patterns to template mappings

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

When you run `aiui build`, any missing components are automatically installed via `npx shadcn add`.

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
    indexFiles:
      - "index.md"
      - "README.md"
    nav:
      mode: "auto"                   # auto | manual
      sort: "filesystem"             # filesystem | alpha | date
      collapsible: true
      maxDepth: 4
```

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
        - type: "Toc"
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

### Available Zones

| Zone | Description |
|------|-------------|
| `header` | Top header |
| `topNav` | Below header nav |
| `hero` | Hero banners |
| `leftSidebar` | Left column |
| `main` | Main content |
| `rightSidebar` | Right column |
| `bottomNav` | Pagination area |
| `footer` | Footer widgets |

### Built-in Widgets

| Widget | Description |
|--------|-------------|
| `StatsCard` | Metrics display |
| `QuickLinks` | Navigation links |
| `Newsletter` | Email signup |
| `HeroBanner` | Hero section |
| `SocialLinks` | Social icons |
| `Copyright` | Copyright text |

See [Widget Zones](../features/widget-zones.md) for full documentation.

## Routes

Map URL patterns to templates:

```yaml
routes:
  - match: "/docs/**"
    template: "docs"

  - match: "/docs/changelog"
    template: "docs"
    slots:
      right: null                      # Override: hide TOC
```

Route matching uses glob patterns:
- `*` - Single segment
- `**` - Multiple segments

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

In addition to `aiui.template.yaml` (which drives static site generation), PraisonAIUI uses a **unified runtime config file** at `~/.praisonaiui/config.yaml`. This file stores all feature state — agents, channels, guardrails, schedules, and runtime settings — in a single YAML file that persists across server restarts.

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
      bot_token: "${TELEGRAM_BOT_TOKEN}"

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

- **Atomic writes**: Uses `tempfile` + `os.rename()` to prevent corruption.
- **Hot reload**: The [Config Hot-Reload](../features/config-hot-reload.md) feature watches this file for external changes.
- **Environment variables**: Use `${ENV_VAR}` syntax for secrets (never stored in plaintext).

#### Environment Variable vs Config File

| | Env Variable | Config File |
|---|---|---|
| **Security** | ✅ Not in source control | ⚠️ Risk of committing secrets to git |
| **12-Factor App** | ✅ Standard practice | ❌ Violates config-as-env principle |
| **CI/CD** | ✅ Easy to inject per environment | ❌ Needs file management |
| **Docker/K8s** | ✅ Native secret support | ❌ Requires volume mounts |
| **Multiple envs** | ✅ Different key per env (dev/staging/prod) | ⚠️ Need separate config files |

**Rule of thumb**: Secrets (API keys, tokens) → environment variables. Preferences (model, theme, branding) → config file.

- **Custom path**: Set `PRAISONAIUI_CONFIG_PATH` to use a different file location.

### Relationship to `aiui.template.yaml`

| File | Purpose | Used By |
|------|---------|---------|
| `aiui.template.yaml` | Static site layout, components, routes | `aiui build`, `aiui dev` |
| `~/.praisonaiui/config.yaml` | Runtime feature state (agents, channels, config) | `aiui run`, dashboard API |
| `gateway.yaml` | Subset of `config.yaml` (legacy compatibility) | `praisonai gateway start` |
