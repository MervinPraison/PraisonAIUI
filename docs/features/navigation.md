# Navigation

Configure automatic and manual navigation generation.

## Auto Navigation

By default, navigation is generated from your docs folder structure:

```yaml
content:
  docs:
    nav:
      mode: "auto"
      sort: "filesystem"
```

### Sort Options

| Mode | Description |
|------|-------------|
| `filesystem` | Use file order on disk |
| `alpha` | Alphabetical by title |
| `date` | By creation date |

## Navigation Tree

Generated navigation follows this format:

```json
{
  "items": [
    {
      "title": "Getting Started",
      "slug": "getting-started",
      "children": [
        { "title": "Installation", "slug": "getting-started/installation" },
        { "title": "Quick Start", "slug": "getting-started/quickstart" }
      ]
    }
  ]
}
```

## Collapsible Sections

```yaml
content:
  docs:
    nav:
      collapsible: true
      maxDepth: 4
```

## Manual Navigation

For full control, use manual mode:

```yaml
content:
  docs:
    nav:
      mode: "manual"
      items:
        - title: "Home"
          href: "/docs"
        - title: "Guides"
          children:
            - title: "Installation"
              href: "/docs/installation"
```
