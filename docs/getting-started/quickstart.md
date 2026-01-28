# Quick Start

Create your first PraisonAIUI project in under 5 minutes.

## 1. Initialize a Project

```bash
aiui init
```

This creates:
- `aiui.template.yaml` - Your site configuration
- `docs/` - Starter documentation folder

## 2. Explore the Configuration

```yaml
# aiui.template.yaml
schemaVersion: 1

site:
  title: "My Documentation"
  description: "Built with PraisonAIUI"

content:
  docs:
    dir: "./docs"

templates:
  docs:
    layout: "ThreeColumnLayout"
    slots:
      header: { ref: "header_main" }
      left: { ref: "sidebar_docs" }
      main: { type: "DocContent" }
      footer: { ref: "footer_main" }

components:
  header_main:
    type: "Header"
    props:
      logoText: "My Docs"

  sidebar_docs:
    type: "DocsSidebar"
    props:
      source: "docs-nav"

  footer_main:
    type: "Footer"
    props:
      text: "© 2024"

routes:
  - match: "/docs/**"
    template: "docs"
```

## 3. Validate Configuration

```bash
aiui validate
# ✓ Configuration is valid
```

## 4. Build Manifests

```bash
aiui build
```

This generates:
- `aiui/ui-config.json` - Site configuration
- `aiui/docs-nav.json` - Navigation tree
- `aiui/route-manifest.json` - Route mappings

## 5. Start Development

```bash
aiui dev
# ⏳ Watching aiui.template.yaml for changes...
```

## Next Steps

- [CLI Usage](cli.md) - Learn all CLI commands
- [Configuration](../concepts/configuration.md) - Deep dive into YAML schema
- [Templates](../concepts/templates.md) - Understanding templates and slots
