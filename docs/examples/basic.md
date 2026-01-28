# Basic Examples

Simple examples to get started with PraisonAIUI.

## Minimal Docs Site

The simplest configuration:

```yaml
schemaVersion: 1

site:
  title: "My Docs"

content:
  docs:
    dir: "./docs"

templates:
  docs:
    layout: "ThreeColumnLayout"
    slots:
      main: { type: "DocContent" }

routes:
  - match: "/docs/**"
    template: "docs"
```

## With Header and Footer

Add branding:

```yaml
schemaVersion: 1

site:
  title: "My Project"

content:
  docs:
    dir: "./docs"

components:
  header:
    type: "Header"
    props:
      logoText: "My Project"
      cta:
        label: "GitHub"
        href: "https://github.com/myorg/myproject"

  footer:
    type: "Footer"
    props:
      text: "© 2024 My Company"

templates:
  docs:
    layout: "ThreeColumnLayout"
    slots:
      header: { ref: "header" }
      left: { type: "DocsSidebar", props: { source: "docs-nav" } }
      main: { type: "DocContent" }
      right: { type: "Toc" }
      footer: { ref: "footer" }

routes:
  - match: "/docs/**"
    template: "docs"
```

## Directory Structure

```
my-docs/
├── aiui.template.yaml
├── docs/
│   ├── index.md
│   ├── getting-started/
│   │   ├── installation.md
│   │   └── quickstart.md
│   └── guides/
│       └── configuration.md
└── package.json
```
