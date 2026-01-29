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

| Layout | Slots |
|--------|-------|
| `ThreeColumnLayout` | header, left, main, right, footer |
| `DefaultLayout` | header, hero, main, footer |

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
